/**
 * chrome.runtime.sendMessage-Bruecke fuer Popup und Options-Seite.
 *
 * `shared/messages.js` traegt nur noch die Nachrichtentyp-Konstanten — der
 * Versand braucht `chrome` und liegt deshalb hier, ausserhalb der
 * testbaren `shared/`-Schicht.
 *
 * @param {string} type
 * @param {Record<string, any>} [payload]
 * @returns {Promise<any>}
 */
export async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (response && response.ok === false) {
    const error = new Error(response.error?.message || 'request failed');
    Object.assign(error, response.error || {});
    throw error;
  }
  return response ? response.data : undefined;
}