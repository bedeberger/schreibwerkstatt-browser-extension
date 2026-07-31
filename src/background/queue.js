/**
 * Retry-Warteschlange.
 *
 * Grundsatz aus der Spezifikation: nie stillschweigend verwerfen.
 * Ein Auftrag verlaesst die Queue nur, wenn er erfolgreich war oder wenn
 * der Nutzer ihn ausdruecklich loescht. Auch endgueltig gescheiterte
 * Auftraege bleiben sichtbar stehen.
 *
 * Persistenz und Uhr sind injizierbar, damit sich das ohne Chrome testen laesst.
 */

import { exhausted, nextDelay } from '../shared/backoff.js';
import { describeError, isRetryable } from '../shared/errors.js';
import { JOB_STATE } from '../shared/config.js';

/**
 * @param {object} deps
 * @param {() => Promise<import('../shared/config.js').CaptureJob[]>} deps.load
 * @param {(jobs: import('../shared/config.js').CaptureJob[]) => Promise<void>} deps.save
 * @param {() => number} [deps.now]
 * @param {() => number} [deps.random]
 * @param {(key: string, subs?: string[]) => string} [deps.translate]
 */
export function createQueue({ load, save, now = () => Date.now(), random = Math.random, translate }) {
  /** Schreibvorgaenge serialisieren — der Worker kann parallel geweckt werden. */
  let chain = Promise.resolve();

  /**
   * @template T
   * @param {(jobs: import('../shared/config.js').CaptureJob[]) => T|Promise<T>} mutator
   * @returns {Promise<T>}
   */
  function transaction(mutator) {
    const run = chain.then(async () => {
      const jobs = await load();
      const result = await mutator(jobs);
      await save(jobs);
      return result;
    });
    // Fehler duerfen die Kette nicht abreissen lassen.
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** @returns {Promise<import('../shared/config.js').CaptureJob[]>} */
  async function list() {
    return load();
  }

  /**
   * @param {import('../shared/config.js').CaptureIntent} intent
   * @param {object} [options]
   * @param {number} [options.holdMs] Undo-Fenster; solange Zustand `held`
   * @returns {Promise<import('../shared/config.js').CaptureJob>}
   */
  async function add(intent, options = {}) {
    const holdMs = Math.max(0, Number(options.holdMs) || 0);
    const timestamp = now();
    /** @type {import('../shared/config.js').CaptureJob} */
    const job = {
      id: `job_${timestamp.toString(36)}_${Math.floor(random() * 1e9).toString(36)}`,
      createdAt: timestamp,
      attempts: 0,
      runAfter: timestamp + holdMs,
      state: holdMs > 0 ? JOB_STATE.HELD : JOB_STATE.PENDING,
      lastError: null,
      intent,
      progress: {
        researchItemId: null,
        sourceId: null,
        linkedBookIds: [],
        imageUploaded: false,
        pdfUploaded: false,
        via: null,
      },
    };

    await transaction((jobs) => {
      jobs.push(job);
    });
    return job;
  }

  /**
   * Faellige Auftraege, aelteste zuerst. `held` zaehlt erst nach Ablauf
   * des Undo-Fensters als faellig.
   *
   * @returns {Promise<import('../shared/config.js').CaptureJob[]>}
   */
  async function due() {
    const timestamp = now();
    const jobs = await load();
    return jobs
      .filter(
        (job) =>
          (job.state === JOB_STATE.PENDING || job.state === JOB_STATE.HELD || job.state === JOB_STATE.RUNNING) &&
          job.runAfter <= timestamp,
      )
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * @param {string} id
   * @param {Partial<import('../shared/config.js').CaptureJob>} patch
   */
  async function update(id, patch) {
    return transaction((jobs) => {
      const job = jobs.find((entry) => entry.id === id);
      if (!job) return null;
      Object.assign(job, patch);
      return job;
    });
  }

  /**
   * Endet erfolgreich: Auftrag verlaesst die Queue.
   * @param {string} id
   */
  async function complete(id) {
    return transaction((jobs) => {
      const index = jobs.findIndex((entry) => entry.id === id);
      if (index >= 0) jobs.splice(index, 1);
      return index >= 0;
    });
  }

  /**
   * Nur auf ausdrueckliche Nutzeraktion (Undo oder „Eintrag verwerfen").
   * @param {string} id
   */
  async function discard(id) {
    return complete(id);
  }

  /**
   * Verbucht einen Fehlschlag und plant den naechsten Versuch.
   *
   * @param {string} id
   * @param {any} error
   * @param {import('../shared/config.js').CaptureProgress} [progress] Teilfortschritt sichern
   * @returns {Promise<{job: import('../shared/config.js').CaptureJob|null, willRetry: boolean}>}
   */
  async function fail(id, error, progress) {
    return transaction((jobs) => {
      const job = jobs.find((entry) => entry.id === id);
      if (!job) return { job: null, willRetry: false };

      if (progress) job.progress = { ...job.progress, ...progress };

      job.attempts += 1;
      const described = describeError(error, translate || ((key) => key));
      job.lastError = { code: described.code, text: described.text, at: now() };

      const willRetry = isRetryable(error) && !exhausted(job.attempts);
      if (willRetry) {
        job.state = JOB_STATE.PENDING;
        job.runAfter = now() + nextDelay(job.attempts, 0.2, random);
      } else {
        job.state = JOB_STATE.FAILED;
        job.runAfter = Number.MAX_SAFE_INTEGER;
      }
      return { job, willRetry };
    });
  }

  /**
   * Setzt einen Auftrag manuell wieder in die Warteschlange.
   * @param {string} id
   */
  async function retryNow(id) {
    return transaction((jobs) => {
      const job = jobs.find((entry) => entry.id === id);
      if (!job) return null;
      job.state = JOB_STATE.PENDING;
      job.runAfter = now();
      job.attempts = 0;
      return job;
    });
  }

  /**
   * Zieht einen Auftrag im Undo-Fenster zurueck.
   * @param {string} id
   * @returns {Promise<boolean>} false, wenn das Fenster schon zu war
   */
  async function undo(id) {
    return transaction((jobs) => {
      const index = jobs.findIndex((entry) => entry.id === id);
      if (index < 0) return false;
      const job = jobs[index];
      if (job.state !== JOB_STATE.HELD) return false;
      jobs.splice(index, 1);
      return true;
    });
  }

  /**
   * Zeitpunkt, zu dem der Worker das naechste Mal geweckt werden muss.
   * @returns {Promise<number|null>}
   */
  async function nextWakeAt() {
    const jobs = await load();
    const times = jobs
      .filter((job) => job.state === JOB_STATE.PENDING || job.state === JOB_STATE.HELD)
      .map((job) => job.runAfter)
      .filter((value) => Number.isFinite(value));
    if (!times.length) return null;
    return Math.min(...times);
  }

  /**
   * Zaehler fuer das Badge.
   * @returns {Promise<{total: number, pending: number, failed: number, held: number}>}
   */
  async function counts() {
    const jobs = await load();
    return {
      total: jobs.length,
      pending: jobs.filter((job) => job.state === JOB_STATE.PENDING || job.state === JOB_STATE.RUNNING).length,
      failed: jobs.filter((job) => job.state === JOB_STATE.FAILED).length,
      held: jobs.filter((job) => job.state === JOB_STATE.HELD).length,
    };
  }

  return { list, add, due, update, complete, discard, fail, retryNow, undo, nextWakeAt, counts };
}
