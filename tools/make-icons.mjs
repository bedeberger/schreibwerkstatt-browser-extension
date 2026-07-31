/**
 * Erzeugt die PNG-Icons ohne externe Abhaengigkeit.
 *
 * Bewusst kein Bildpaket und kein Binaerblob im Repo, den niemand
 * nachvollziehen kann: das Motiv steht als Code hier und laesst sich
 * mit `npm run icons` reproduzieren.
 *
 * Motiv: dunkelblaue Kachel, weisses Blatt mit Textzeilen,
 * bernsteinfarbener Punkt als „erfasst"-Marke.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'icons');
const SIZES = [16, 32, 48, 128];

const INK = [0x22, 0x40, 0x5f];
const PAPER = [0xff, 0xff, 0xff];
const ACCENT = [0xd9, 0x83, 0x24];

/** Kantenglaettung durch Ueberabtastung. */
const SUPERSAMPLE = 4;

/**
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @returns {[number, number, number, number]|null} RGBA oder null (transparent)
 */
function shade(x, y, size) {
  const u = x / size;
  const v = y / size;

  // Abgerundete Kachel
  if (!insideRoundedRect(u, v, 0, 0, 1, 1, 0.18)) return null;

  // Blatt
  if (insideRoundedRect(u, v, 0.26, 0.18, 0.74, 0.82, 0.05)) {
    // Textzeilen
    const lines = [
      [0.35, 0.65, 0.30],
      [0.35, 0.65, 0.435],
      [0.35, 0.56, 0.57],
    ];
    for (const [x0, x1, y0] of lines) {
      if (u >= x0 && u <= x1 && v >= y0 && v <= y0 + 0.055) return [...INK, 255];
    }
    return [...PAPER, 255];
  }

  // Marke unten rechts
  const dx = u - 0.735;
  const dy = v - 0.755;
  if (dx * dx + dy * dy <= 0.125 * 0.125) return [...ACCENT, 255];

  return [...INK, 255];
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} left
 * @param {number} top
 * @param {number} right
 * @param {number} bottom
 * @param {number} radius
 */
function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const r = Math.min(radius, (right - left) / 2, (bottom - top) / 2);
  const cx = Math.min(Math.max(x, left + r), right - r);
  const cy = Math.min(Math.max(y, top + r), bottom - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * @param {number} size
 * @returns {Buffer} RGBA-Rohdaten mit Filterbyte je Zeile
 */
function renderRaw(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;

  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0; // Filter „None"
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const px = x + (sx + 0.5) / SUPERSAMPLE;
          const py = y + (sy + 0.5) / SUPERSAMPLE;
          const sample = shade(px, py, size);
          if (!sample) continue;
          r += sample[0];
          g += sample[1];
          b += sample[2];
          a += sample[3];
        }
      }

      const samples = SUPERSAMPLE * SUPERSAMPLE;
      // Farbe ueber die TREFFER mitteln, Deckkraft ueber alle Abtastpunkte —
      // sonst zieht der transparente Rand die Farbe nach Schwarz.
      const hits = a / 255;
      raw[offset] = hits ? Math.round(r / hits) : 0;
      raw[offset + 1] = hits ? Math.round(g / hits) : 0;
      raw[offset + 2] = hits ? Math.round(b / hits) : 0;
      raw[offset + 3] = Math.round(a / samples);
      offset += 4;
    }
  }

  return raw;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/** @param {Buffer} buffer */
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} type
 * @param {Buffer} data
 */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** @param {number} size */
function makePng(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 6; // Farbtyp RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(renderRaw(size), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, makePng(size));
  process.stdout.write(`icon-${size}.png\n`);
}
