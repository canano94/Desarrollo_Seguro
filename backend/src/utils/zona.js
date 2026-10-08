/**
 * ZONA HORARIA DE LA AGENDA
 *
 * El servidor de Azure corre en UTC. Si se arma la fecha con
 * new Date(2026, 9, 7, 7, 0) eso son las 07:00 UTC = 02:00 en Colombia.
 * Por eso toda hora "de pared" (la que ve el cliente) se convierte con
 * el desfase explícito de la empresa.
 *
 * Colombia no tiene horario de verano, así que un desfase fijo basta.
 * Se puede cambiar con la variable ZONA_HORARIA_OFFSET (ej. -05:00).
 */

const PATRON = /^([+-])(\d{2}):(\d{2})$/;
const configurado = process.env.ZONA_HORARIA_OFFSET ?? '-05:00';

export const OFFSET = PATRON.test(configurado) ? configurado : '-05:00';

const [, signo, hh, mm] = OFFSET.match(PATRON);
const OFFSET_MIN = (signo === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm));

/** "2026-10-07" + "08:30" (hora local de la empresa) -> instante real. */
export function instanteLocal(fecha, hora) {
  return new Date(`${fecha}T${hora}:00${OFFSET}`);
}

/** Día de la semana de una fecha "YYYY-MM-DD": 1 = lunes ... 7 = domingo. */
export function diaSemana(fecha) {
  const d = new Date(`${fecha}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return d === 0 ? 7 : d;
}

/** Un instante -> fecha, día y minutos del día, vistos en la hora local. */
export function partesLocales(instante) {
  const local = new Date(instante.getTime() + OFFSET_MIN * 60_000);
  const fecha = local.toISOString().slice(0, 10);
  return {
    fecha,
    dia: diaSemana(fecha),
    minutos: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

/** "08:30" -> 510 */
export function aMinutos(hora) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}