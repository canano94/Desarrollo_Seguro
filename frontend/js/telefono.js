// Archivo con la funcion para crear el boton de llamar a un cliente
// Usa un link tel:, que en el celular abre la app de telefono con el numero ya marcado

// Funcion que deja solo los numeros y el + del inicio, por ejemplo "(601) 555-12 34" queda "6015551234"
// Asi el link funciona aunque el numero se haya escrito con espacios, guiones o parentesis
export function numeroLimpio(telefono) {
  const texto = String(telefono ?? '').trim();
  const mas = texto.startsWith('+') ? '+' : '';
  return mas + texto.replace(/\D/g, '');
}

// Funcion que crea el icono del telefono en SVG
// Se crea con createElementNS y no con innerHTML para no meter HTML como texto (XSS)
function icono() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const trazo = document.createElementNS(ns, 'path');
  // Dibujo de un telefono, se pinta con el color del texto (currentColor)
  trazo.setAttribute('d', 'M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z');
  trazo.setAttribute('fill', 'currentColor');
  svg.append(trazo);
  return svg;
}

// Se exporta la funcion enlaceLlamar que devuelve el link para llamar, o null si no hay numero
// texto es lo que dice el boton, si no se pasa se muestra el numero
// soloIcono deja un boton redondo solo con el telefono, para filas donde no cabe texto
export function enlaceLlamar(telefono, { texto, mini = true, soloIcono = false } = {}) {
  const numero = numeroLimpio(telefono);
  // Si quedan menos de 7 digitos no es un numero valido para llamar
  if (numero.replace('+', '').length < 7) return null;

  const enlace = document.createElement('a');
  enlace.href = `tel:${numero}`;
  enlace.className = soloIcono ? 'llamar llamar--icono' : (mini ? 'llamar llamar--mini' : 'llamar');
  enlace.append(icono());
  if (!soloIcono) {
    // Se usa textContent y no innerHTML para que no se pueda meter codigo (XSS)
    const etiqueta = document.createElement('span');
    etiqueta.textContent = texto ?? telefono;
    enlace.append(etiqueta);
  }
  enlace.setAttribute('aria-label', `Llamar al ${telefono}`);
  enlace.title = `Llamar al ${telefono}`;
  return enlace;
}

// Se exporta la funcion filaCliente que arma la fila "Cliente: nombre" con el link a su ficha
// y el boton redondo para llamarlo. Se usa en el detalle del turno y en el detalle del caso
// conEnlace es false si la persona no tiene permiso para ver la ficha de clientes
export function filaCliente(contenedor, { idCliente, nombre, telefono, conEnlace = true }) {
  contenedor.replaceChildren();

  const etiqueta = document.createElement('span');
  etiqueta.className = 'fila-cliente__etiqueta';
  etiqueta.textContent = 'Cliente';

  // Si puede ver clientes el nombre es un link a la ficha, si no es solo texto
  let nombreNodo;
  if (conEnlace && idCliente) {
    nombreNodo = document.createElement('a');
    // Se usa URLSearchParams para que el id vaya bien escrito en la URL
    nombreNodo.href = `clientes.html?${new URLSearchParams({ cliente: idCliente })}`;
    nombreNodo.textContent = `${nombre} ›`;
    nombreNodo.title = 'Ver la ficha del cliente';
  } else {
    nombreNodo = document.createElement('span');
    nombreNodo.textContent = nombre;
  }
  nombreNodo.classList.add('fila-cliente__nombre');

  const datos = document.createElement('div');
  datos.className = 'fila-cliente__datos';
  datos.append(etiqueta, nombreNodo);
  contenedor.append(datos);

  // Si tiene telefono se agrega el boton redondo para llamar a la derecha
  const llamar = enlaceLlamar(telefono, { soloIcono: true });
  if (llamar) contenedor.append(llamar);
  contenedor.hidden = false;
}
