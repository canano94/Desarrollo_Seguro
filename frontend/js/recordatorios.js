// Archivo de la tarjeta "Recordatorios de turnos" de la pantalla de perfil
// Aqui cada persona activa las notificaciones en su celular o PC y elige con cuanto tiempo le avisan
import { pedir, restaurarSesion, sesionActual } from './api.js';

// Funcion corta para buscar un elemento por su id
const $ = (id) => document.getElementById(id);

// Se toman los elementos de la tarjeta
const tarjeta = $('tarjeta-recordatorios');
const fichaEstado = $('rec-estado');
const textoDispositivos = $('rec-dispositivos');
const selectMinutos = $('rec-minutos');
const ayuda = $('rec-ayuda');
const aviso = $('aviso-recordatorios');
const btnActivar = $('rec-activar');
const btnDesactivar = $('rec-desactivar');
const btnPrueba = $('rec-prueba');

// Variable con lo que devuelve el servidor (llave publica, tiempos y dispositivos)
let estado = null;

// Funcion para mostrar un mensaje en el aviso de la tarjeta, en verde si salio bien
function avisar(mensaje, bien = false) {
  // Se usa textContent y no innerHTML para que no se pueda meter codigo (XSS)
  aviso.textContent = mensaje;
  aviso.classList.toggle('aviso--bien', bien);
  aviso.hidden = !mensaje;
}

// Funcion que arma el texto del error que devuelve la API
function mensajeError(error) {
  const detalle = error?.detalles?.map((d) => d.mensaje ?? d.message).filter(Boolean).join(' · ');
  return detalle || error?.mensaje || error?.message || 'Ocurrió un error inesperado.';
}

// Funcion para saber si el navegador soporta notificaciones push
const soportaPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// Funcion que devuelve el permiso de notificaciones, en navegadores sin Notification se toma como no pedido
const permisoActual = () => ('Notification' in window ? Notification.permission : 'default');

// Funcion para saber si es un iPhone o iPad que abrio la pagina en Safari y no desde la app instalada
// En iPhone las notificaciones solo funcionan si la app esta agregada a la pantalla de inicio
function iphoneSinInstalar() {
  const esIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const instalada = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return esIos && !instalada;
}

// Funcion que convierte la llave publica de base64url a bytes, que es como la pide el navegador
function llaveABytes(base64) {
  const relleno = '='.repeat((4 - (base64.length % 4)) % 4);
  const texto = atob((base64 + relleno).replace(/-/g, '+').replace(/_/g, '/'));
  // Se usa Uint8Array.from para pasar cada letra a su numero
  return Uint8Array.from(texto, (c) => c.charCodeAt(0));
}

// Funcion que trae el registro del service worker, si no esta se registra
async function registroSw() {
  await navigator.serviceWorker.register('service-worker.js');
  return navigator.serviceWorker.ready;
}

// Funcion que devuelve la suscripcion de este dispositivo o null si no tiene
async function suscripcionActual() {
  if (!soportaPush()) return null;
  const registro = await registroSw();
  return registro.pushManager.getSubscription();
}

// Funcion que llena el select con los tiempos, la primera opcion es el tiempo de la empresa
function pintarMinutos() {
  selectMinutos.replaceChildren();
  const opciones = [
    ['', `Lo que defina la empresa (${estado.minutosEmpresa} min antes)`],
    ['15', '15 minutos antes'],
    ['30', '30 minutos antes'],
    ['60', '1 hora antes'],
  ];
  // Se recorre con for para crear cada opcion
  for (const [valor, texto] of opciones) {
    const o = document.createElement('option');
    o.value = valor;
    o.textContent = texto;
    o.selected = String(estado.minutos ?? '') === valor;
    selectMinutos.append(o);
  }
}

// Funcion que pinta la tarjeta segun si este dispositivo tiene los recordatorios activos
async function pintar() {
  const suscripcion = await suscripcionActual().catch(() => null);
  const activo = Boolean(suscripcion) && permisoActual() === 'granted';

  fichaEstado.textContent = activo ? 'Activos en este dispositivo' : 'Apagados en este dispositivo';
  fichaEstado.className = activo ? 'ficha' : 'ficha ficha--alerta';
  textoDispositivos.textContent = estado.dispositivos > 0
    ? `${estado.dispositivos} dispositivo(s) con avisos en tu cuenta`
    : '';

  btnActivar.hidden = activo;
  btnDesactivar.hidden = !activo;
  btnPrueba.hidden = !activo;

  // Se explica por que no se puede activar, si es el caso
  let motivo = '';
  if (!estado.configurado) motivo = 'Los recordatorios todavía no están activos en el servidor.';
  else if (iphoneSinInstalar()) motivo = 'En iPhone primero agrega la app a la pantalla de inicio (Compartir › Agregar a inicio) y ábrela desde ahí.';
  else if (!soportaPush()) motivo = 'Este navegador no permite notificaciones. Prueba con Chrome, Edge, Firefox o Safari actualizado.';
  else if (permisoActual() === 'denied') motivo = 'Bloqueaste las notificaciones para esta página. Actívalas en los ajustes del navegador y vuelve a intentarlo.';
  ayuda.textContent = motivo;
  ayuda.hidden = !motivo;
  btnActivar.disabled = Boolean(motivo);
}

// Funcion que manda la suscripcion al servidor para que la guarde con esta persona
async function enviarSuscripcion(suscripcion) {
  // toJSON devuelve endpoint y las dos llaves, que es lo que pide el esquema del backend
  await pedir('/push/suscripcion', { metodo: 'POST', cuerpo: suscripcion.toJSON() });
}

// Evento del boton activar: pide permiso, crea la suscripcion y la manda al servidor
btnActivar.addEventListener('click', async () => {
  avisar('');
  btnActivar.disabled = true;
  try {
    // Se llama a requestPermission, el navegador le muestra a la persona la ventana de permiso
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') {
      avisar('Sin el permiso de notificaciones no te podemos avisar.');
      return;
    }

    const registro = await registroSw();
    const opciones = { userVisibleOnly: true, applicationServerKey: llaveABytes(estado.clavePublica) };
    let suscripcion;
    // Se usa try/catch porque si habia una suscripcion vieja con otra llave el navegador no deja crear otra
    try {
      suscripcion = await registro.pushManager.subscribe(opciones);
    } catch {
      const vieja = await registro.pushManager.getSubscription();
      if (vieja) await vieja.unsubscribe();
      suscripcion = await registro.pushManager.subscribe(opciones);
    }

    await enviarSuscripcion(suscripcion);
    estado = await pedir('/push/estado');
    avisar('Listo. Te avisaremos antes de cada turno confirmado.', true);
  } catch (error) {
    avisar(mensajeError(error));
  } finally {
    btnActivar.disabled = false;
    await pintar();
  }
});

// Evento del boton desactivar: borra la suscripcion del servidor y del navegador
btnDesactivar.addEventListener('click', async () => {
  avisar('');
  btnDesactivar.disabled = true;
  try {
    const suscripcion = await suscripcionActual();
    if (suscripcion) {
      await pedir('/push/suscripcion', { metodo: 'DELETE', cuerpo: { endpoint: suscripcion.endpoint } });
      await suscripcion.unsubscribe();
    }
    estado = await pedir('/push/estado');
    avisar('Recordatorios apagados en este dispositivo.', true);
  } catch (error) {
    avisar(mensajeError(error));
  } finally {
    btnDesactivar.disabled = false;
    await pintar();
  }
});

// Evento del boton de prueba, el servidor manda un aviso a todos los dispositivos de la persona
btnPrueba.addEventListener('click', async () => {
  avisar('');
  btnPrueba.disabled = true;
  try {
    const { enviados } = await pedir('/push/prueba', { metodo: 'POST' });
    avisar(enviados > 0
      ? 'Prueba enviada. Debería llegarte en unos segundos.'
      : 'No se pudo entregar la prueba. Desactiva y vuelve a activar los recordatorios.', enviados > 0);
  } catch (error) {
    avisar(mensajeError(error));
  } finally {
    btnPrueba.disabled = false;
  }
});

// Evento del select, al cambiar el tiempo se guarda de una vez
selectMinutos.addEventListener('change', async () => {
  avisar('');
  // Si eligio la primera opcion se manda null para usar el tiempo de la empresa
  const minutos = selectMinutos.value === '' ? null : Number(selectMinutos.value);
  try {
    await pedir('/push/minutos', { metodo: 'PUT', cuerpo: { minutos } });
    estado.minutos = minutos;
    avisar('Tiempo del recordatorio guardado.', true);
  } catch (error) {
    avisar(mensajeError(error));
    pintarMinutos();
  }
});

// Funcion que arranca la tarjeta
async function iniciar() {
  // Se espera la sesion, si perfil.js ya la esta pidiendo se reutiliza la misma peticion
  const sesion = sesionActual() ?? (await restaurarSesion());
  // Si no hay sesion o no hay empresa elegida no se muestra la tarjeta
  if (!sesion?.empresaActiva) return;

  estado = await pedir('/push/estado');
  pintarMinutos();
  await pintar();
  tarjeta.hidden = false;

  // Si este dispositivo ya tenia suscripcion se vuelve a mandar al servidor
  // Asi, si en este celular entro otra persona, los avisos pasan a quien esta ahora
  const suscripcion = await suscripcionActual().catch(() => null);
  if (suscripcion && permisoActual() === 'granted' && estado.configurado) {
    await enviarSuscripcion(suscripcion).catch(() => {});
  }
}

// Se llama a iniciar, si falla solo se deja la tarjeta oculta para no dañar el resto del perfil
iniciar().catch((error) => console.warn('No se pudo cargar la tarjeta de recordatorios:', error));
