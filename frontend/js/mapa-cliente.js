// Archivo con las funciones del mapa del cliente
// Se usa la libreria Leaflet (js/vendor/leaflet) con los mapas gratis de OpenStreetMap
// Leaflet se carga con una etiqueta script normal y queda en window.L

// Constante con la direccion de donde salen los cuadros (imagenes) del mapa
const CUADROS = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
// Texto de creditos, las reglas de OpenStreetMap piden mostrarlo siempre en el mapa
const CREDITOS = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
// Punto donde arranca el mapa cuando el cliente no tiene ubicacion (Bogota)
const CENTRO_INICIAL = [4.711, -74.0721];

// Funcion para dejar la coordenada con 6 decimales, igual que en la base de datos
const redondear = (n) => Math.round(n * 1e6) / 1e6;

// Se exporta la funcion hayMapa para saber si la libreria cargo bien
export function hayMapa() {
  return typeof window.L === 'object' && typeof window.L.map === 'function';
}

// Se exporta la funcion enlaceComoLlegar que arma el link de Google Maps con la ruta hasta el cliente
// En el celular abre la app de Google Maps, no necesita llave de API
export function enlaceComoLlegar(latitud, longitud) {
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('destination', `${latitud},${longitud}`);
  return url.toString();
}

// Se exporta la funcion crearMapa que pinta el mapa dentro del contenedor que se le pase
// Si editable es true se puede tocar el mapa o arrastrar el pin, y se avisa con alCambiar
export function crearMapa(contenedor, { latitud = null, longitud = null, editable = false, alCambiar } = {}) {
  const L = window.L;
  const tienePunto = latitud !== null && longitud !== null;

  // Se crea el mapa, si es solo para ver se quita el zoom con la rueda para que no moleste al bajar la pagina
  const mapa = L.map(contenedor, {
    center: tienePunto ? [latitud, longitud] : CENTRO_INICIAL,
    zoom: tienePunto ? 17 : 12,
    scrollWheelZoom: editable,
  });
  // Se quita el texto "Leaflet" de los creditos y se deja solo el de OpenStreetMap
  mapa.attributionControl.setPrefix(false);

  // Se agregan los cuadros de OpenStreetMap
  // referrerPolicy manda solo el dominio de la app, OpenStreetMap lo pide para no bloquear los cuadros
  L.tileLayer(CUADROS, {
    maxZoom: 19,
    attribution: CREDITOS,
    referrerPolicy: 'strict-origin-when-cross-origin',
  }).addTo(mapa);

  // Variable para guardar el pin, empieza en null si no hay ubicacion
  let pin = null;

  // Funcion que avisa a la pantalla que el punto cambio
  const avisar = () => {
    if (typeof alCambiar !== 'function') return;
    if (!pin) { alCambiar(null); return; }
    const { lat, lng } = pin.getLatLng();
    alCambiar({ latitud: redondear(lat), longitud: redondear(lng) });
  };

  // Funcion para poner el pin en un punto, si ya existe solo se mueve
  function poner(lat, lng, centrar = true) {
    if (pin) {
      pin.setLatLng([lat, lng]);
    } else {
      pin = L.marker([lat, lng], { draggable: editable, keyboard: editable, title: 'Ubicación del cliente' }).addTo(mapa);
      // Si es editable, al soltar el pin despues de arrastrarlo se avisa el punto nuevo
      if (editable) pin.on('dragend', avisar);
    }
    if (centrar) mapa.setView([lat, lng], Math.max(mapa.getZoom(), 17));
    avisar();
  }

  // Funcion para quitar el pin del mapa
  function quitar() {
    if (pin) { pin.remove(); pin = null; }
    avisar();
  }

  if (tienePunto) poner(latitud, longitud, false);

  // Si es editable, al tocar el mapa se pone el pin donde se toco
  if (editable) {
    mapa.on('click', (evento) => poner(evento.latlng.lat, evento.latlng.lng, false));
  }

  // Se devuelve un objeto con las funciones para manejar el mapa desde la pantalla
  return {
    poner,
    quitar,
    // Funcion que devuelve el punto actual o null si no hay pin
    punto() {
      if (!pin) return null;
      const { lat, lng } = pin.getLatLng();
      return { latitud: redondear(lat), longitud: redondear(lng) };
    },
    // Leaflet calcula el tamaño al crearse, si el contenedor estaba oculto hay que recalcularlo al mostrarlo
    refrescar() { mapa.invalidateSize(); },
    // Funcion para borrar el mapa y liberar la memoria cuando ya no se usa
    destruir() { mapa.remove(); },
  };
}
