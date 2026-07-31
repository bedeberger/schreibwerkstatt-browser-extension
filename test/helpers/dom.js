/**
 * Laedt eine HTML-Fixture in ein jsdom-Dokument.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

/**
 * @param {string} name Dateiname ohne Pfad, z. B. "blog-og.html"
 * @param {string} url Adresse, unter der die Seite ausgeliefert wurde
 * @returns {Promise<Document>}
 */
export async function loadFixture(name, url) {
  const html = await readFile(join(FIXTURES, name), 'utf8');
  const dom = new JSDOM(html, { url, contentType: 'text/html' });
  return dom.window.document;
}
