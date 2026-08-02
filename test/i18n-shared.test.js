/**
 * Tests fuer die reine i18n-Logik in `src/shared/i18n.js`.
 *
 * Das Modul ist chrome-frei; `t` ist hier die Identitaet. Die chrome-Bruecke
 * in `src/ui/chrome-i18n.js` ist davon unberuehrt.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyI18n, formatRelativeTime, t } from '../src/shared/i18n.js';

describe('shared/i18n', () => {
  it('t ohne chrome ist die Identitaet — gibt den Schluessel zurueck', () => {
    assert.equal(t('popup_title'), 'popup_title');
    assert.equal(t('popup_count', ['5']), 'popup_count');
  });

  it('formatRelativeTime nutzt den uebergebenen Uebersetzer fuer die Sprache', () => {
    const de = formatRelativeTime(Date.now() - 60_000, Date.now(), () => 'de');
    // „vor einer Minute" in de-DE ist „vor 1 Minute"; nur Sprache pruefen.
    assert.match(de, /1\s*Minute/);

    const en = formatRelativeTime(Date.now() - 60_000, Date.now(), () => 'en-GB');
    assert.match(en, /1\s*minute/);
  });

  it('formatRelativeTime: 0-Timestamp liefert leer', () => {
    assert.equal(formatRelativeTime(0, Date.now(), () => 'de'), '');
  });

  it('applyI18n setzt nur Werte, die sich vom Schluessel unterscheiden', async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<div><span data-i18n="x"></span><span data-i18n="y"></span></div>');
    const document = dom.window.document;
    applyI18n(
      document,
      (key) => (key === 'x' ? 'gesetzt' : key),
    );
    assert.equal(document.querySelector('[data-i18n="x"]').textContent, 'gesetzt');
    assert.equal(document.querySelector('[data-i18n="y"]').textContent, '', 'y bleibt unveraendert');
  });

  it('applyI18n setzt Attribute aus data-i18n-attr', async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<input data-i18n-attr="placeholder:x_hint" />');
    const document = dom.window.document;
    applyI18n(document, (key) => (key === 'x_hint' ? 'Hinweistext' : key));
    assert.equal(document.querySelector('input').getAttribute('placeholder'), 'Hinweistext');
  });

  it('applyI18n laat leerwertige Specification links liegen', async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<div data-i18n-attr="placeholder:bad,href:linky" />');
    const document = dom.window.document;
    applyI18n(document, (key) => (key === 'linky' ? 'about:blank' : key));
    const node = document.querySelector('div');
    assert.equal(node.getAttribute('href'), 'about:blank');
    assert.equal(node.hasAttribute('placeholder'), false, 'leerer Schluessel wird nicht gesetzt');
  });
});