
// Expresion regular para revisar que la zona horaria venga como +HH:MM o -HH:MM
const PATRON = /^([+-])(\d{2}):(\d{2})$/;
// Se lee la zona horaria del .env, si no viene se usa -05:00 que es la de Colombia
const configurado = process.env.ZONA_HORARIA_OFFSET ?? '-05:00';

// Se exporta la constante OFFSET, si la del .env no tiene el formato correcto se usa -05:00
export const OFFSET = PATRON.test(configurado) ? configurado : '-05:00';

// Se separa el signo, las horas y los minutos del offset
const [, signo, hh, mm] = OFFSET.match(PATRON);
// Constante con el offset pasado a minutos, negativo si es -
const OFFSET_MIN = (signo === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm));

// Se exporta la funcion instanteLocal que junta una fecha y una hora locales en un Date
export function instanteLocal(fecha, hora) {
  return new Date(`${fecha}T${hora}:00${OFFSET}`);
}

// Se exporta la funcion diaSemana que devuelve el dia de la semana de 1 (lunes) a 7 (domingo)
export function diaSemana(fecha) {
  // Se usa el mediodia en UTC para que la zona horaria no cambie el dia
  const d = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  // getUTCDay da 0 para el domingo, por eso se cambia a 7
  return d === 0 ? 7 : d;
}

// Se exporta la funcion partesLocales que saca la fecha, el dia y los minutos en hora local
export function partesLocales(instante) {
  // Se le suma el offset a la hora para pasarla a la hora local
  const local = new Date(instante.getTime() + OFFSET_MIN * 60_000);
  // Se toman los primeros 10 caracteres para quedarse con la fecha AAAA-MM-DD
  const fecha = local.toISOString().slice(0, 10);
  return {
    fecha,
    dia: diaSemana(fecha),
    // Minutos que van desde la medianoche
    minutos: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

// Se exporta la funcion aMinutos que pasa una hora HH:MM a minutos
export function aMinutos(hora) {
  // Se separa por los dos puntos y se usa map para pasar cada parte a numero
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}