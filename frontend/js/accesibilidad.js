// Archivo con ayudas de accesibilidad que sirven en todas las pantallas
// Se carga desde pie.js, asi no hay que agregarlo pagina por pagina

// Funcion que devuelve las pestañas visibles de una lista de pestañas
function pestanasVisibles(lista) {
  return [...lista.querySelectorAll('[role="tab"]')].filter((p) => !p.hidden);
}

// Funcion que deja en el orden del tabulador solo la pestaña elegida (tabindex "itinerante")
// Asi con Tab se entra a la lista una sola vez y con las flechas se cambia de pestaña,
// que es como funcionan las pestañas para quien usa teclado o lector de pantalla
function ordenarTabulador(lista) {
  const pestanas = pestanasVisibles(lista);
  const elegida = pestanas.find((p) => p.getAttribute('aria-selected') === 'true') ?? pestanas[0];
  for (const p of lista.querySelectorAll('[role="tab"]')) {
    p.tabIndex = p === elegida ? 0 : -1;
    // Si la pestaña dice que panel abre, se une con aria-controls para el lector de pantalla
    if (p.dataset.panel && !p.hasAttribute('aria-controls')) p.setAttribute('aria-controls', p.dataset.panel);
  }
}

// Funcion que prepara todas las listas de pestañas de la pagina
function prepararPestanas() {
  for (const lista of document.querySelectorAll('[role="tablist"]')) {
    ordenarTabulador(lista);
    // Si el codigo de la pagina cambia la pestaña elegida o agrega pestañas, se vuelve a ordenar
    new MutationObserver(() => ordenarTabulador(lista)).observe(lista, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected', 'hidden'],
    });
  }
}

// Flechas, Inicio y Fin para moverse entre pestañas
// Al llegar a una pestaña se le hace clic, porque cada pagina ya abre su panel con el clic
document.addEventListener('keydown', (e) => {
  const pestana = e.target.closest?.('[role="tab"]');
  const lista = pestana?.closest('[role="tablist"]');
  if (!lista) return;

  const pestanas = pestanasVisibles(lista);
  const i = pestanas.indexOf(pestana);
  let destino = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') destino = pestanas[(i + 1) % pestanas.length];
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') destino = pestanas[(i - 1 + pestanas.length) % pestanas.length];
  else if (e.key === 'Home') destino = pestanas[0];
  else if (e.key === 'End') destino = pestanas[pestanas.length - 1];
  if (!destino) return;

  // preventDefault para que las flechas no muevan la pagina
  e.preventDefault();
  destino.click();
  destino.focus();
});

// Enter y Espacio en los elementos que se abren con clic pero no son botones (por ejemplo, filas de una tabla)
// Esos elementos se marcan con data-clic y tabindex="0" en el codigo de cada pagina
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const elemento = e.target.closest?.('[data-clic]');
  // Solo si el foco esta en el propio elemento, no en un boton o enlace que tenga adentro
  if (!elemento || e.target !== elemento) return;
  e.preventDefault();
  elemento.click();
});

// Se preparan las pestañas cuando la pagina ya esta lista
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', prepararPestanas);
} else {
  prepararPestanas();
}
