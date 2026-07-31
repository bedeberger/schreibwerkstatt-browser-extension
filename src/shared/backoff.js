/**
 * Exponentielles Backoff fuer die Retry-Queue.
 * Eigenes Modul, damit die Kurve ohne Chrome-APIs testbar ist.
 */

/** Wartezeiten je Versuchszahl in Millisekunden. */
const SCHEDULE = [
  15 * 1000,
  60 * 1000,
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
];

/** Danach bleibt es bei sechs Stunden. */
const MAX_DELAY = SCHEDULE[SCHEDULE.length - 1];

/**
 * Ab so vielen Versuchen gilt ein Auftrag als haengengeblieben.
 * Er wird NICHT geloescht — nur nicht mehr automatisch wiederholt.
 */
export const MAX_ATTEMPTS = 12;

/**
 * @param {number} attempts Anzahl bereits fehlgeschlagener Versuche (>= 1)
 * @param {number} [jitterRatio] Anteil zufaelliger Streuung, 0 = deterministisch
 * @param {() => number} [random]
 * @returns {number} Wartezeit in Millisekunden
 */
export function nextDelay(attempts, jitterRatio = 0.2, random = Math.random) {
  const index = Math.max(1, Math.floor(attempts)) - 1;
  const base = index < SCHEDULE.length ? SCHEDULE[index] : MAX_DELAY;
  if (!jitterRatio) return base;
  // Streuung nur nach oben, damit ein serverseitiger Ausfall nicht von
  // allen Eintraegen im selben Moment erneut angefragt wird.
  return Math.round(base * (1 + jitterRatio * random()));
}

/**
 * @param {number} attempts
 * @returns {boolean}
 */
export function exhausted(attempts) {
  return Math.floor(attempts) >= MAX_ATTEMPTS;
}
