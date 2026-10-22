// Se importan conEmpresa para trabajar dentro de la RLS y query para lo que no es de una empresa
import { conEmpresa, query } from '../db/pool.js';
// Se importan las funciones de Brevo para saber si esta configurado y para mandar el correo
import { correoConfigurado, enviarCorreo } from '../utils/brevo.js';
// Se importa encolarCorreoTurno para dejar en cola los recordatorios de un dia antes
import { encolarCorreoTurno, conSavepoint } from './notificaciones.service.js';

// Proceso que manda los correos
// Corre dentro del mismo servidor (server.js lo arranca) y cada minuto:
//   1. Pregunta que empresas tienen trabajo (funcion SECURITY DEFINER que solo devuelve ids, script 23)
//   2. Por cada empresa, dentro de su RLS:
//      a. Deja en cola los recordatorios de los turnos de las proximas 24 horas
//      b. Toma hasta 20 correos pendientes y los marca ENVIANDO
//      c. Los manda por Brevo y anota ENVIADO, o programa un reintento
// Reintentos: a los 1, 2, 4 y 8 minutos. Si Brevo dice que el correo esta mal (4xx) no se reintenta

// Constante con cada cuanto se revisa la cola, 1 minuto
const CADA_MS = 60_000;
// Constante con cuantos correos se mandan por empresa en cada vuelta
const LOTE = 20;
// Constante con el maximo de intentos antes de dejar el correo en ERROR
const MAX_INTENTOS = 5;

// Variable para no empezar una vuelta si la anterior no ha terminado
let trabajando = false;

// Funcion que oculta el correo para los logs, por ejemplo ana@correo.com queda a***@correo.com
// Asi los logs no guardan datos personales completos
const ocultar = (correo) => String(correo).replace(/^(.).*(@.*)$/, '$1***$2');

// Funcion que deja en cola los recordatorios de un dia antes de los turnos confirmados
async function recordatorios(idEmpresa) {
  await conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL que marca los turnos de las proximas 2 a 24 horas que no tienen recordatorio
    // FOR UPDATE SKIP LOCKED evita que dos instancias del servidor tomen el mismo turno
    const { rows } = await client.query(
      `UPDATE app.reservas SET recordatorio_en = now()
        WHERE id_reserva IN (
          SELECT id_reserva FROM app.reservas
           WHERE estado = 'CONFIRMADA'
             AND recordatorio_en IS NULL
             AND fecha_inicio BETWEEN now() + interval '2 hours' AND now() + interval '24 hours'
           LIMIT 50
           FOR UPDATE SKIP LOCKED)
        RETURNING id_reserva`,
    );
    // Se recorre con for para dejar en cola el correo de cada turno
    for (const r of rows) {
      await conSavepoint(client, () => encolarCorreoTurno(client, idEmpresa, r.id_reserva, 'TURNO_RECORDATORIO'));
    }
  });
}

// Funcion que trae el nombre del remitente y el correo para respuestas de la empresa (script 24)
// Va con conSavepoint: si todavia no se ejecuto el script 24, se usa lo de por defecto y el correo igual sale
async function remitenteDeEmpresa(client, idEmpresa) {
  const fila = await conSavepoint(client, async () => {
    const { rows } = await client.query(
      'SELECT nombre_remitente, correo_respuesta FROM app.configuracion_empresa WHERE id_empresa = $1',
      [idEmpresa],
    );
    return rows[0] ?? null;
  });
  return fila || {};
}

// Funcion que toma un lote de correos pendientes y los marca como ENVIANDO
async function tomarLote(idEmpresa) {
  return conEmpresa(idEmpresa, async (client) => {
    // Si el servidor se reinicio en medio de un envio, esos correos vuelven a la cola a los 10 minutos
    await client.query(
      `UPDATE app.correos_pendientes SET estado = 'PENDIENTE', actualizado_en = now()
        WHERE estado = 'ENVIANDO' AND actualizado_en < now() - interval '10 minutes'`,
    );
    // Consulta SQL que toma los correos pendientes, suma un intento y los devuelve con el nombre de la empresa
    const { rows } = await client.query(
      `UPDATE app.correos_pendientes
          SET estado = 'ENVIANDO', intentos = intentos + 1, actualizado_en = now()
        WHERE id_correo IN (
          SELECT id_correo FROM app.correos_pendientes
           WHERE estado = 'PENDIENTE' AND programado_para <= now()
           ORDER BY id_correo
           LIMIT $1
           FOR UPDATE SKIP LOCKED)
        RETURNING id_correo, evento, destinatario, nombre_destinatario, asunto, html, texto, intentos,
                  enlace_baja,
                  (SELECT razon_social FROM app.empresas WHERE id_empresa = $2) AS empresa`,
      [LOTE, idEmpresa],
    );
    if (rows.length === 0) return rows;
    // Se le agrega a cada correo el remitente que configuro la empresa
    const remitente = await remitenteDeEmpresa(client, idEmpresa);
    return rows.map((r) => ({
      ...r,
      empresa: remitente.nombre_remitente || r.empresa,
      responderA: remitente.correo_respuesta || null,
    }));
  });
}

// Funcion que anota como le fue a cada correo: enviado, error o reintento
async function anotar(idEmpresa, resultados) {
  if (resultados.length === 0) return;
  await conEmpresa(idEmpresa, async (client) => {
    for (const r of resultados) {
      if (r.ok) {
        // Si salio bien se marca ENVIADO, o SIMULADO si se esta en modo prueba
        await client.query(
          `UPDATE app.correos_pendientes
              SET estado = $2, id_mensaje_proveedor = $3, ultimo_error = NULL,
                  enviado_en = now(), actualizado_en = now()
            WHERE id_correo = $1`,
          [r.idCorreo, r.simulado ? 'SIMULADO' : 'ENVIADO', r.idMensaje],
        );
      } else if (r.definitivo || r.intentos >= MAX_INTENTOS) {
        // Si el error es definitivo o ya se intento muchas veces se deja en ERROR con el motivo
        await client.query(
          `UPDATE app.correos_pendientes
              SET estado = 'ERROR', ultimo_error = $2, actualizado_en = now()
            WHERE id_correo = $1`,
          [r.idCorreo, r.error.slice(0, 500)],
        );
      } else {
        // Si no, se programa otro intento con espera que se duplica: 1, 2, 4, 8 minutos
        await client.query(
          `UPDATE app.correos_pendientes
              SET estado = 'PENDIENTE', ultimo_error = $2, actualizado_en = now(),
                  programado_para = now() + make_interval(mins => $3)
            WHERE id_correo = $1`,
          [r.idCorreo, r.error.slice(0, 500), 2 ** (r.intentos - 1)],
        );
      }
    }
  });
}

// Funcion que hace todo el trabajo de una empresa
async function procesarEmpresa(idEmpresa) {
  await recordatorios(idEmpresa);
  const lote = await tomarLote(idEmpresa);
  const real = correoConfigurado();
  // Array con el resultado de cada correo
  const resultados = [];

  for (const c of lote) {
    const base = { idCorreo: c.id_correo, intentos: c.intentos };
    // Modo prueba: sin llave de Brevo no sale nada y queda como SIMULADO
    if (!real) {
      console.info(`[correos] (prueba) #${c.id_correo} ${c.evento} -> ${ocultar(c.destinatario)}`);
      resultados.push({ ...base, ok: true, simulado: true, idMensaje: null });
      continue;
    }
    // Se usa try/catch para anotar el error de ese correo sin frenar los demas
    try {
      const idMensaje = await enviarCorreo({
        para: c.destinatario,
        nombre: c.nombre_destinatario,
        asunto: c.asunto,
        html: c.html,
        texto: c.texto,
        // El nombre del remitente es el de la empresa, asi el cliente sabe de quien es
        remitenteNombre: c.empresa,
        // Si la empresa puso un correo para respuestas, va como Reply-To
        responderA: c.responderA,
        // Si el correo tiene enlace de baja se manda en los encabezados para el boton de Gmail y Outlook
        enlaceBaja: c.enlace_baja,
        etiqueta: c.evento,
      });
      console.info(`[correos] enviado #${c.id_correo} ${c.evento} -> ${ocultar(c.destinatario)}`);
      resultados.push({ ...base, ok: true, idMensaje });
    } catch (error) {
      console.warn(`[correos] fallo #${c.id_correo}: ${error.message}`);
      resultados.push({ ...base, ok: false, error: error.message, definitivo: Boolean(error.definitivo) });
    }
  }

  await anotar(idEmpresa, resultados);
}

// Se exporta la funcion procesarCorreos que hace una vuelta completa por todas las empresas
export async function procesarCorreos() {
  // Si la vuelta anterior no ha terminado se salta esta
  if (trabajando) return;
  trabajando = true;
  try {
    // Se llama a la funcion SECURITY DEFINER que solo devuelve los ids de las empresas con trabajo
    const { rows } = await query('SELECT id_empresa FROM app.empresas_con_trabajo_correo()');
    for (const { id_empresa: idEmpresa } of rows) {
      // Se usa try/catch por empresa para que un problema en una no frene a las demas
      try {
        await procesarEmpresa(idEmpresa);
      } catch (error) {
        console.error(`[correos] empresa ${idEmpresa}:`, error.message);
      }
    }
  } catch (error) {
    console.error('[correos] no se pudo revisar la cola:', error.message);
  } finally {
    trabajando = false;
  }
}

// Se exporta la funcion iniciarCorreos que server.js llama al arrancar
export function iniciarCorreos() {
  console.info(correoConfigurado()
    ? '[correos] envio activo con Brevo'
    : '[correos] modo prueba: falta BREVO_API_KEY o CORREO_REMITENTE, los correos quedan como SIMULADO');
  // unref hace que el temporizador no impida que el proceso se cierre al apagar el servidor
  setInterval(procesarCorreos, CADA_MS).unref();
  setTimeout(procesarCorreos, 5_000).unref();
}
