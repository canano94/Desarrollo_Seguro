// Servicio de las notificaciones por correo
// Que avisos existen lo decide el codigo (EVENTOS). Si cada uno esta activo y con que texto
// lo decide cada empresa en Configuracion > Notificaciones
// Aqui no se mandan los correos: se dejan en app.correos_pendientes y los manda correos.worker.js
import { conEmpresa } from '../db/pool.js';
// Se importa AppError para lanzar errores con codigo y mensaje
import { AppError } from '../utils/errors.js';
// Se importa correoConfigurado para saber si Brevo esta listo o si se esta en modo prueba
import { correoConfigurado } from '../utils/brevo.js';
// Se importa urlsBaja para armar el enlace con el que el cliente deja de recibir los avisos no esenciales
import { urlsBaja } from '../utils/baja.js';

// Constante con la zona horaria para mostrar la fecha y la hora en los correos
const ZONA = 'America/Bogota';

// Array con las variables que la empresa puede usar en el asunto y el mensaje
export const VARIABLES = [
  { nombre: 'cliente', descripcion: 'Nombre del cliente' },
  { nombre: 'servicio', descripcion: 'Servicio del turno' },
  { nombre: 'fecha', descripcion: 'Fecha, ej. lunes 12 de octubre' },
  { nombre: 'hora', descripcion: 'Hora, ej. 10:30 a. m.' },
  { nombre: 'sede', descripcion: 'Sede o prestador' },
  { nombre: 'direccion', descripcion: 'Dirección de la sede' },
  { nombre: 'empresa', descripcion: 'Nombre de tu empresa' },
];

// Objeto con los avisos que existen, cada uno con su nombre, descripcion y texto por defecto
export const EVENTOS = {
  TURNO_SOLICITADO: {
    nombre: 'Turno solicitado',
    descripcion: 'Cuando se pide un turno y queda pendiente de confirmar.',
    asunto: 'Recibimos tu solicitud de turno',
    mensaje: 'Hola {{cliente}},\n\nRecibimos tu solicitud para {{servicio}} el {{fecha}} a las {{hora}}. Te avisaremos apenas quede confirmada.',
  },
  TURNO_CONFIRMADO: {
    nombre: 'Turno confirmado',
    descripcion: 'Cuando el turno queda confirmado.',
    asunto: 'Tu turno quedó confirmado',
    mensaje: 'Hola {{cliente}},\n\nTu turno para {{servicio}} quedó confirmado para el {{fecha}} a las {{hora}} en {{sede}}. Te esperamos.',
  },
  TURNO_REPROGRAMADO: {
    nombre: 'Turno reprogramado',
    descripcion: 'Cuando se cambia la fecha u hora de un turno.',
    asunto: 'Tu turno cambió de fecha',
    mensaje: 'Hola {{cliente}},\n\nTu turno para {{servicio}} quedó para el {{fecha}} a las {{hora}} en {{sede}}. Si no puedes asistir, comunícate con nosotros.',
  },
  TURNO_RECHAZADO: {
    nombre: 'Turno rechazado',
    descripcion: 'Cuando la empresa no puede atender una solicitud.',
    asunto: 'No pudimos confirmar tu turno',
    mensaje: 'Hola {{cliente}},\n\nLamentamos no poder atender tu solicitud para {{servicio}} el {{fecha}} a las {{hora}}. Puedes pedir un nuevo turno en otro horario.',
  },
  TURNO_CANCELADO: {
    nombre: 'Turno cancelado',
    descripcion: 'Cuando se cancela un turno.',
    asunto: 'Tu turno fue cancelado',
    mensaje: 'Hola {{cliente}},\n\nTu turno para {{servicio}} del {{fecha}} a las {{hora}} fue cancelado. Si quieres, puedes agendar uno nuevo.',
  },
  TURNO_RECORDATORIO: {
    nombre: 'Recordatorio del turno',
    descripcion: 'Un día antes de un turno confirmado (entre 2 y 24 horas antes).',
    asunto: 'Recordatorio: tu turno es pronto',
    mensaje: 'Hola {{cliente}},\n\nTe recordamos tu turno para {{servicio}} el {{fecha}} a las {{hora}} en {{sede}}.',
  },
  SERVICIO_REPETIR: {
    nombre: 'Servicio por repetir',
    descripcion: 'El día que toca volver a hacer un servicio que se repite (por ejemplo, un mantenimiento).',
    asunto: 'Es momento de repetir tu servicio',
    mensaje: 'Hola {{cliente}},\n\nYa es momento de repetir tu {{servicio}}. Agenda tu próximo turno cuando quieras, te esperamos en {{sede}}.',
  },
};

// Array con los avisos que NO son esenciales: el cliente puede darse de baja de ellos
// Los demas (solicitado, confirmado, reprogramado, rechazado, cancelado) responden a algo
// que el cliente pidio o que cambia su turno, por eso siempre se envian
export const NO_ESENCIALES = ['TURNO_RECORDATORIO', 'SERVICIO_REPETIR'];

// Objeto que dice que aviso le toca a cada estado nuevo del turno
export const EVENTO_POR_ESTADO = {
  CONFIRMADA: 'TURNO_CONFIRMADO',
  RECHAZADA: 'TURNO_RECHAZADO',
  CANCELADA: 'TURNO_CANCELADO',
};

// Funcion que cambia los caracteres especiales de HTML por su codigo
// Asi un cliente llamado "<script>" se ve como texto en el correo y no se ejecuta
const escaparHtml = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Funcion que reemplaza las variables {{nombre}} por su valor
// Con html en true se escapa todo: el texto que escribio la empresa y los datos
// Si la variable no existe se deja tal cual
function aplicar(plantilla, valores, html) {
  const base = html ? escaparHtml(plantilla) : plantilla;
  return base.replace(/\{\{\s*([a-z]+)\s*\}\}/g, (todo, clave) => {
    if (!Object.hasOwn(valores, clave)) return todo;
    return html ? escaparHtml(valores[clave]) : String(valores[clave] ?? '');
  });
}

// Funcion que arma el correo en HTML con los estilos en linea
// Los programas de correo ignoran las etiquetas <style>, por eso los estilos van en cada etiqueta
function armarHtml({ empresa, mensaje, detalles, enlace, textoBoton = 'Ver mis turnos', baja }) {
  const parrafos = mensaje.split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.5">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

  // Se utiliza filter para quitar los detalles vacios y map para armar una fila por cada uno
  const filas = detalles
    .filter(([, valor]) => valor)
    .map(([etiqueta, valor]) => `
      <tr>
        <td style="padding:6px 16px 6px 0;color:#5f6a72;white-space:nowrap">${escaparHtml(etiqueta)}</td>
        <td style="padding:6px 0;font-weight:600">${escaparHtml(valor)}</td>
      </tr>`).join('');

  const boton = enlace
    ? `<p style="margin:24px 0 0"><a href="${escaparHtml(enlace)}" style="display:inline-block;background:#1d6b57;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">${escaparHtml(textoBoton)}</a></p>`
    : '';

  return `<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:24px;background:#f1f1ec;font-family:Arial,Helvetica,sans-serif;color:#14212b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden">
    <tr><td style="background:#101c26;color:#ffffff;padding:20px 24px;font-size:18px;font-weight:700">${escaparHtml(empresa)}</td></tr>
    <tr><td style="padding:24px">
      ${parrafos}
      ${filas ? `<table role="presentation" cellpadding="0" cellspacing="0" style="border-top:1px solid #d9d9d0;padding-top:12px;margin-top:8px">${filas}</table>` : ''}
      ${boton}
    </td></tr>
    <tr><td style="padding:16px 24px;font-size:12px;line-height:1.5;color:#5f6a72;border-top:1px solid #eeeeea">
      Mensaje automático enviado por OmniGest en nombre de ${escaparHtml(empresa)}.
      ${baja ? `<br>¿No quieres recibir más recordatorios de ${escaparHtml(empresa)}? <a href="${escaparHtml(baja)}" style="color:#1d6b57">Dejar de recibirlos</a>. Los avisos de tus turnos (confirmaciones y cambios) seguirán llegando.` : ''}
    </td></tr>
  </table>
</body></html>`;
}

// Funcion que arma la version en texto plano del correo, para programas que no muestran HTML
function armarTexto({ empresa, mensaje, detalles, enlace, textoBoton = 'Ver mis turnos', baja }) {
  const lineas = detalles.filter(([, v]) => v).map(([e, v]) => `${e}: ${v}`);
  return [
    mensaje, '', ...lineas,
    enlace ? `\n${textoBoton}: ${enlace}` : '',
    `\n-- Mensaje automático enviado por OmniGest en nombre de ${empresa}`,
    baja ? `Para dejar de recibir recordatorios: ${baja}` : '',
  ].join('\n');
}

// Funciones para mostrar la fecha larga (lunes 12 de octubre) y la hora (10:30 a. m.) en hora de Colombia
const fechaLarga = (d) => new Intl.DateTimeFormat('es-CO', {
  timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long',
}).format(d);

const horaCorta = (d) => new Intl.DateTimeFormat('es-CO', {
  timeZone: ZONA, hour: 'numeric', minute: '2-digit',
}).format(d);

// Funcion que devuelve la direccion de la app sin la barra del final, o null si no esta configurada
const urlApp = () => process.env.APP_URL?.replace(/\/+$/, '') || null;

// Funcion que trae como quedo configurado un aviso en la empresa, o el de por defecto
async function configDeEvento(client, evento) {
  // Consulta SQL para traer la configuracion del aviso, la RLS deja solo la de esta empresa
  const { rows } = await client.query(
    'SELECT activo, asunto, mensaje FROM app.notificaciones_config WHERE evento = $1',
    [evento],
  );
  const fila = rows[0];
  return {
    activo: fila?.activo ?? true,
    asunto: fila?.asunto || EVENTOS[evento].asunto,
    mensaje: fila?.mensaje || EVENTOS[evento].mensaje,
  };
}

// Funcion que guarda el correo en la bandeja de salida
async function guardarEnCola(client, {
  idEmpresa, evento, referencia, para, nombre, config, valores, contenido, enlaceBaja = null,
}) {
  // Consulta SQL para dejar el correo en cola, con $ para evitar inyeccion SQL
  // enlace_baja es la direccion para el boton de baja que muestran Gmail y Outlook (script 25)
  await client.query(
    `INSERT INTO app.correos_pendientes
       (id_empresa, evento, referencia, destinatario, nombre_destinatario, asunto, html, texto, enlace_baja)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      idEmpresa,
      evento,
      referencia,
      para,
      nombre,
      aplicar(config.asunto, valores, false).slice(0, 200),
      armarHtml({ ...contenido, mensaje: aplicar(config.mensaje, valores, true) }),
      armarTexto({ ...contenido, mensaje: aplicar(config.mensaje, valores, false) }),
      enlaceBaja,
    ],
  );
}

// Funcion que revisa si el aviso se puede mandar a este cliente y arma su enlace de baja
// Si el aviso no es esencial y el cliente se dio de baja devuelve null (no se manda)
// Si el aviso no es esencial y si se manda, devuelve los enlaces de baja
function revisarBaja(evento, idEmpresa, t) {
  if (!NO_ESENCIALES.includes(evento)) return { pagina: null, api: null };
  if (t.baja_avisos_en) return null;
  return urlsBaja(idEmpresa, t.id_cliente) ?? { pagina: null, api: null };
}

// Se exporta la funcion conSavepoint, envuelve el encolado en un SAVEPOINT de la transaccion
// Si el correo falla (por ejemplo, si no se ha ejecutado el script 23) se deshace solo el correo
// y el turno igual se guarda. Un correo nunca debe impedir que se agende un turno
export async function conSavepoint(client, fn) {
  await client.query('SAVEPOINT correo');
  try {
    const resultado = await fn();
    await client.query('RELEASE SAVEPOINT correo');
    return resultado;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT correo');
    console.warn('[correos] no se pudo dejar en cola:', error.message);
    return false;
  }
}

// Se exporta la funcion encolarCorreoTurno que deja en cola el correo de un turno para su cliente
// Recibe el client de la transaccion que ya esta abierta, asi el correo queda solo si el turno se guarda
// No hace nada si el aviso esta apagado o el cliente no tiene correo
export async function encolarCorreoTurno(client, idEmpresa, idReserva, evento) {
  if (!EVENTOS[evento]) return false;
  const config = await configDeEvento(client, evento);
  if (!config.activo) return false;

  // Consulta SQL para traer los datos del turno, del cliente y de la empresa
  // empresas va con LEFT JOIN para que si no se puede leer igual salga el correo con un nombre generico
  const { rows } = await client.query(
    `SELECT r.fecha_inicio, s.nombre AS servicio, p.nombre AS sede, p.direccion,
            c.id_cliente, c.email, c.nombres, c.baja_avisos_en,
            CONCAT_WS(' ', c.nombres, c.apellidos) AS cliente,
            e.razon_social AS empresa
       FROM app.reservas r
       JOIN app.servicios   s ON s.id_servicio  = r.id_servicio
       JOIN app.prestadores p ON p.id_prestador = r.id_prestador
       JOIN app.clientes    c ON c.id_cliente   = r.id_cliente
       LEFT JOIN app.empresas e ON e.id_empresa = r.id_empresa
      WHERE r.id_reserva = $1`,
    [idReserva],
  );
  const t = rows[0];
  // Si el cliente no tiene correo no hay a quien mandarlo
  if (!t?.email) return false;
  // Si es un recordatorio y el cliente se dio de baja no se manda
  const baja = revisarBaja(evento, idEmpresa, t);
  if (!baja) return false;

  const inicio = new Date(t.fecha_inicio);
  // Objeto con los valores de las variables {{...}}
  const valores = {
    cliente: t.nombres || t.cliente || 'cliente',
    servicio: t.servicio,
    fecha: fechaLarga(inicio),
    hora: horaCorta(inicio),
    sede: t.sede,
    direccion: t.direccion ?? '',
    empresa: t.empresa || 'Tu proveedor de servicios',
  };
  const app = urlApp();

  await guardarEnCola(client, {
    idEmpresa,
    evento,
    referencia: String(idReserva),
    para: t.email,
    nombre: t.cliente,
    config,
    valores,
    contenido: {
      empresa: valores.empresa,
      detalles: [
        ['Servicio', valores.servicio],
        ['Fecha', valores.fecha],
        ['Hora', valores.hora],
        ['Sede', valores.sede],
        ['Dirección', valores.direccion],
      ],
      enlace: app ? `${app}/agenda.html` : null,
      baja: baja.pagina,
    },
    enlaceBaja: baja.api,
  });
  return true;
}

// Se exporta la funcion encolarCorreoRepetir que avisa al cliente que toca repetir un servicio
// El boton del correo abre la agenda con el servicio ya elegido
export async function encolarCorreoRepetir(client, idEmpresa, idRepetir) {
  const config = await configDeEvento(client, 'SERVICIO_REPETIR');
  if (!config.activo) return false;

  // Consulta SQL para traer el servicio, la sede, el cliente y la fecha del turno anterior
  const { rows } = await client.query(
    `SELECT r.id_servicio, s.nombre AS servicio, p.nombre AS sede, p.direccion,
            c.id_cliente, c.email, c.nombres, c.baja_avisos_en,
            CONCAT_WS(' ', c.nombres, c.apellidos) AS cliente,
            ro.fecha_inicio AS ultima_vez, e.razon_social AS empresa
       FROM app.servicios_repetir r
       JOIN app.servicios   s  ON s.id_servicio  = r.id_servicio
       JOIN app.prestadores p  ON p.id_prestador = r.id_prestador
       JOIN app.clientes    c  ON c.id_cliente   = r.id_cliente
       JOIN app.reservas    ro ON ro.id_reserva  = r.id_reserva_origen
       LEFT JOIN app.empresas e ON e.id_empresa  = r.id_empresa
      WHERE r.id_repetir = $1`,
    [idRepetir],
  );
  const t = rows[0];
  if (!t?.email) return false;
  // Si el cliente se dio de baja de los avisos no esenciales no se manda
  const baja = revisarBaja('SERVICIO_REPETIR', idEmpresa, t);
  if (!baja) return false;

  const ultima = new Date(t.ultima_vez);
  const valores = {
    cliente: t.nombres || t.cliente || 'cliente',
    servicio: t.servicio,
    fecha: fechaLarga(ultima),
    hora: horaCorta(ultima),
    sede: t.sede,
    direccion: t.direccion ?? '',
    empresa: t.empresa || 'Tu proveedor de servicios',
  };
  const app = urlApp();

  await guardarEnCola(client, {
    idEmpresa,
    evento: 'SERVICIO_REPETIR',
    referencia: String(idRepetir),
    para: t.email,
    nombre: t.cliente,
    config,
    valores,
    contenido: {
      empresa: valores.empresa,
      detalles: [
        ['Servicio', valores.servicio],
        ['Última vez', valores.fecha],
        ['Sede', valores.sede],
      ],
      // Se usa URLSearchParams para que el id del servicio vaya bien escrito en el link
      enlace: app ? `${app}/agenda.html?${new URLSearchParams({ servicio: t.id_servicio })}` : null,
      textoBoton: 'Agendar ahora',
      baja: baja.pagina,
    },
    enlaceBaja: baja.api,
  });
  return true;
}

// Se exporta la funcion obtenerRemitente que trae el nombre y el correo de respuesta de la empresa
export async function obtenerRemitente(idEmpresa) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer el remitente y el nombre de la empresa por si no ha puesto uno
    const { rows } = await client.query(
      `SELECT e.razon_social, c.nombre_remitente, c.correo_respuesta
         FROM app.empresas e
         LEFT JOIN app.configuracion_empresa c ON c.id_empresa = e.id_empresa
        WHERE e.id_empresa = $1`,
      [idEmpresa],
    );
    const f = rows[0] ?? {};
    return {
      nombreRemitente: f.nombre_remitente ?? null,
      correoRespuesta: f.correo_respuesta ?? null,
      // Nombre que se usa si la empresa no pone uno
      nombrePorDefecto: f.razon_social ?? null,
      // Correo desde el que salen todos los correos de la plataforma
      correoPlataforma: process.env.CORREO_REMITENTE ?? null,
    };
  });
}

// Se exporta la funcion guardarRemitente para el nombre y el correo de respuesta de la empresa
// null o vacio quiere decir que se usa lo de por defecto
export async function guardarRemitente(idEmpresa, datos) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL que inserta la configuracion, y si ya existe solo cambia el remitente
    await client.query(
      `INSERT INTO app.configuracion_empresa (id_empresa, nombre_remitente, correo_respuesta)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_empresa)
       DO UPDATE SET nombre_remitente = EXCLUDED.nombre_remitente,
                     correo_respuesta = EXCLUDED.correo_respuesta,
                     updated_at = now()`,
      [idEmpresa, datos.nombreRemitente || null, datos.correoRespuesta || null],
    );
    return { nombreRemitente: datos.nombreRemitente || null, correoRespuesta: datos.correoRespuesta || null };
  });
}

// Se exporta la funcion listarConfiguracion para la pestaña Notificaciones de Configuracion
export async function listarConfiguracion(idEmpresa) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer lo que la empresa ya configuro
    const { rows } = await client.query(
      'SELECT evento, activo, asunto, mensaje FROM app.notificaciones_config',
    );
    return {
      // Si Brevo no esta configurado la pantalla avisa que esta en modo prueba
      correoActivo: correoConfigurado(),
      variables: VARIABLES,
      // Se utiliza el metodo map para armar cada aviso con lo de la empresa o el texto por defecto
      eventos: Object.entries(EVENTOS).map(([evento, meta]) => {
        const fila = rows.find((r) => r.evento === evento);
        return {
          evento,
          nombre: meta.nombre,
          descripcion: meta.descripcion,
          activo: fila?.activo ?? true,
          asunto: fila?.asunto || meta.asunto,
          mensaje: fila?.mensaje || meta.mensaje,
          personalizado: Boolean(fila?.asunto || fila?.mensaje),
        };
      }),
    };
  });
}

// Se exporta la funcion guardarEvento para guardar un aviso de la empresa
// Si el texto es igual al de por defecto se guarda NULL, asi si se mejora el texto por defecto le llega a la empresa
export async function guardarEvento(idEmpresa, evento, datos) {
  const meta = EVENTOS[evento];
  // Funcion que devuelve el texto propio o null si es igual al original o si se pidio restaurar
  const propio = (valor, original) => (!datos.restaurar && valor && valor !== original ? valor : null);
  const asunto = propio(datos.asunto, meta.asunto);
  const mensaje = propio(datos.mensaje, meta.mensaje);

  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL que inserta la configuracion del aviso, y si ya existe la actualiza
    await client.query(
      `INSERT INTO app.notificaciones_config (id_empresa, evento, activo, asunto, mensaje)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id_empresa, evento) DO UPDATE
         SET activo = EXCLUDED.activo, asunto = EXCLUDED.asunto,
             mensaje = EXCLUDED.mensaje, updated_at = now()`,
      [idEmpresa, evento, datos.activo, asunto, mensaje],
    );
    return { evento, activo: datos.activo, personalizado: Boolean(asunto || mensaje) };
  });
}

// Se exporta la funcion historial que trae los ultimos 50 correos de la empresa
export async function historial(idEmpresa) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer los ultimos correos, sin el contenido para no mandar de mas
    const { rows } = await client.query(
      `SELECT id_correo, evento, destinatario, asunto, estado, intentos,
              ultimo_error, creado_en, enviado_en
         FROM app.correos_pendientes
        ORDER BY id_correo DESC
        LIMIT 50`,
    );
    return rows.map((r) => ({
      idCorreo: Number(r.id_correo),
      evento: r.evento,
      nombreEvento: EVENTOS[r.evento]?.nombre ?? (r.evento === 'PRUEBA' ? 'Correo de prueba' : r.evento),
      destinatario: r.destinatario,
      asunto: r.asunto,
      estado: r.estado,
      intentos: r.intentos,
      error: r.ultimo_error,
      creado: r.creado_en,
      enviado: r.enviado_en,
    }));
  });
}

// Se exporta la funcion encolarPrueba que manda un correo de prueba al mismo administrador
// Usa el texto del aviso con datos de ejemplo, asi se ve como queda sin crear turnos
export async function encolarPrueba(idEmpresa, idUsuario, evento) {
  if (!EVENTOS[evento]) {
    throw new AppError(404, 'EVENTO_NO_ENCONTRADO', 'Ese aviso no existe.');
  }
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer el correo del usuario que pidio la prueba
    const { rows: usuarios } = await client.query(
      'SELECT email, nombres FROM app.usuarios WHERE id_usuario = $1',
      [idUsuario],
    );
    const usuario = usuarios[0];
    if (!usuario?.email) {
      throw new AppError(422, 'SIN_CORREO', 'Tu usuario no tiene correo.');
    }
    // Consulta SQL para traer el nombre de la empresa
    const { rows: empresas } = await client.query(
      'SELECT razon_social FROM app.empresas WHERE id_empresa = $1', [idEmpresa],
    );

    const config = await configDeEvento(client, evento);
    const manana = new Date(Date.now() + 24 * 60 * 60_000);
    // Objeto con datos de ejemplo para la prueba
    const valores = {
      cliente: usuario.nombres || 'cliente',
      servicio: 'Servicio de ejemplo',
      fecha: fechaLarga(manana),
      hora: '10:00 a. m.',
      sede: 'Sede principal',
      direccion: 'Calle 1 # 2-3',
      empresa: empresas[0]?.razon_social || 'Tu empresa',
    };

    await guardarEnCola(client, {
      idEmpresa,
      evento: 'PRUEBA',
      referencia: null,
      para: usuario.email,
      nombre: usuario.nombres,
      config: { ...config, asunto: `[Prueba] ${config.asunto}` },
      valores,
      contenido: {
        empresa: valores.empresa,
        detalles: [['Servicio', valores.servicio], ['Fecha', valores.fecha], ['Hora', valores.hora], ['Sede', valores.sede]],
        enlace: null,
        // En los avisos no esenciales se muestra como se ve el enlace de baja (en la prueba no da de baja a nadie)
        baja: NO_ESENCIALES.includes(evento) && urlApp() ? `${urlApp()}/baja.html?t=prueba` : null,
      },
    });
    return { destinatario: usuario.email };
  });
}
