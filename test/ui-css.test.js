/**
 * Eine einzige Regel, die aber alles traegt: Popup und Options-Seite steuern
 * jeden Zustand ueber das `hidden`-Attribut. Fehlt die `[hidden]`-Regel, gewinnt
 * die naechstbeste eigene `display`-Angabe (`.panel { display: flex }`) gegen
 * das UA-Stylesheet, und alle Zustaende stehen gleichzeitig im Bild — genau so
 * aufgefallen beim Aufnehmen der Store-Screenshots.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const SRC = join(dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, ''), 'src');

describe('ui.css', () => {
  it('setzt [hidden] gegen jede eigene display-Regel durch', async () => {
    const css = (await readFile(join(SRC, 'shared', 'ui.css'), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = css.match(/\[hidden\]\s*\{[^}]*\}/);
    assert.ok(rule, '[hidden]-Regel fehlt');
    assert.match(rule[0], /display:\s*none\s*!important/);
  });
});
