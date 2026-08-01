/**
 * Kleinstmoeglicher Client fuer das Chrome DevTools Protocol.
 *
 * Nur so viel, wie `make-shots.mjs` braucht: verbinden, Kommandos schicken,
 * auf Ereignisse warten, an Ziele anhaengen. Bewusst ohne Abhaengigkeit —
 * Node bringt `WebSocket` seit v22 selbst mit, und ein Bildwerkzeug ist kein
 * Grund, dem Projekt eine Laufzeitabhaengigkeit zu verpassen.
 */

import { sleep } from './chrome.mjs';

/** @param {string} url z. B. http://127.0.0.1:9222 */
export async function browserWebSocketUrl(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${url}/json/version`);
      const info = await response.json();
      if (info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl;
    } catch {
      // Chrome laeuft noch nicht — weiter warten.
    }
    if (Date.now() > deadline) throw new Error(`Kein DevTools-Endpunkt unter ${url} erreichbar.`);
    await sleep(200);
  }
}

export class Cdp {
  /** @param {string} wsUrl */
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    /** @type {Map<number, {resolve: Function, reject: Function}>} */
    this.pending = new Map();
    /** @type {Array<{match: Function, resolve: Function}>} */
    this.waiters = [];
    this.events = [];
  }

  async connect() {
    this.socket = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(new Error('DevTools-Verbindung fehlgeschlagen')), { once: true });
    });
    this.socket.addEventListener('message', (event) => this.#onMessage(String(event.data)));
    return this;
  }

  #onMessage(raw) {
    const message = JSON.parse(raw);
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message} (${message.method ?? ''})`));
      else resolve(message.result);
      return;
    }
    if (message.method) {
      this.events.push(message);
      for (const waiter of [...this.waiters]) {
        if (waiter.match(message)) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    }
  }

  /**
   * @param {string} method
   * @param {object} [params]
   * @param {string} [sessionId]
   */
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.socket.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`Zeitüberschreitung bei ${method}`));
      }, 30_000);
    });
  }

  /** Haengt an ein Ziel an und liefert die Sitzungs-ID. */
  async attach(targetId) {
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    return sessionId;
  }

  /** @param {(target: any) => boolean} predicate */
  async findTarget(predicate, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { targetInfos } = await this.send('Target.getTargets');
      const hit = targetInfos.find(predicate);
      if (hit) return hit;
      if (Date.now() > deadline) return null;
      await sleep(250);
    }
  }

  close() {
    try {
      this.socket?.close();
    } catch {
      // egal
    }
  }
}
