/**
 * Vorbehalte an einem gelungenen Auftrag.
 *
 * Der Punkt dieser Tests ist nicht die Formatierung, sondern die Frage, ob ein
 * Auftrag, der beim Server ankommt und dabei etwas verliert, das noch sagen
 * kann. Er verlaesst die Warteschlange — die Notiz muss also VORHER in die
 * Quittung gewandert sein, sonst gibt es sie nicht mehr.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { attachmentsAreLost, incompleteNotices, incompleteText } from '../src/shared/outcome.js';

describe('attachmentsAreLost', () => {
  it('liegen die Bytes noch im Speicher, ist nichts verloren', () => {
    assert.equal(attachmentsAreLost({ screenshot: true, pdf: true }, {}, true), false);
  });

  it('erkennt den Verlust nach einem Neustart des Workers', () => {
    assert.equal(attachmentsAreLost({ screenshot: true }, {}, false), true);
    assert.equal(attachmentsAreLost({ pdf: true }, {}, false), true);
  });

  it('ein bereits hochgeladener Anhang ist kein Verlust', () => {
    // Erster Versuch hat das Bild abgeliefert und ist erst danach gescheitert.
    assert.equal(attachmentsAreLost({ screenshot: true }, { imageUploaded: true }, false), false);
    assert.equal(attachmentsAreLost({ pdf: true }, { pdfUploaded: true }, false), false);
  });

  it('was nie angehaengt war, kann nicht verloren gehen', () => {
    assert.equal(attachmentsAreLost({}, {}, false), false);
    assert.equal(attachmentsAreLost(undefined, undefined, false), false);
  });

  it('meldet Verlust, solange auch nur EIN Anhang aussteht', () => {
    assert.equal(
      attachmentsAreLost({ screenshot: true, pdf: true }, { imageUploaded: true }, false),
      true,
    );
  });
});

describe('incompleteNotices', () => {
  it('ein vollstaendig gesendeter Auftrag meldet nichts', () => {
    assert.deepEqual(incompleteNotices({ researchItemId: 7, sourceId: 3 }), []);
    assert.deepEqual(incompleteNotices(), []);
  });

  it('nennt den verlorenen Anhang', () => {
    assert.deepEqual(incompleteNotices({ attachmentsLost: true }), [
      { key: 'notice_attachment_lost', substitutions: [] },
    ]);
  });

  it('nennt den verworfenen Zitierschluessel mitsamt Wortlaut', () => {
    assert.deepEqual(incompleteNotices({ citekeyDropped: 'muster2019' }), [
      { key: 'notice_citekey_dropped', substitutions: ['muster2019'] },
    ]);
  });

  it('ein leerer Zitierschluessel ist keine Meldung', () => {
    assert.deepEqual(incompleteNotices({ citekeyDropped: '   ' }), []);
    assert.deepEqual(incompleteNotices({ citekeyDropped: '' }), []);
  });

  it('sammelt mehrere Vorbehalte', () => {
    const notices = incompleteNotices({ attachmentsLost: true, citekeyDropped: 'x2020' });
    assert.deepEqual(
      notices.map((notice) => notice.key),
      ['notice_attachment_lost', 'notice_citekey_dropped'],
    );
  });
});

describe('incompleteText', () => {
  const translate = (key, subs = []) => `${key}(${subs.join(',')})`;

  it('leer heisst: nichts anzuhaengen', () => {
    assert.equal(incompleteText({}, translate), '');
  });

  it('uebersetzt mit Platzhaltern', () => {
    assert.equal(incompleteText({ citekeyDropped: 'a1' }, translate), 'notice_citekey_dropped(a1)');
  });

  it('verbindet mehrere Vorbehalte zu einem Satz', () => {
    assert.equal(
      incompleteText({ attachmentsLost: true, citekeyDropped: 'a1' }, translate),
      'notice_attachment_lost() notice_citekey_dropped(a1)',
    );
  });
});
