// One-off: the iPad view's home-screen and manifest icons -- a square "KUI"
// monogram, white on the app's ink (#0f1729). public/logo.png is a 1288x240
// wordmark, unreadable at 180px, so the icon is drawn rather than resized.
//
//   node scripts/make-icons.mjs
//
// Writes public/icons/apple-touch-icon.png (180), icon-192.png and
// icon-512.png, and public/favicon.ico (16 and 32, PNG frames) -- the file
// every browser asks for at /favicon.ico; without it that request 404s on
// every page. The letters sit inside the middle 60%, so the 192 and 512 can
// also serve as maskable icons (Android crops to a circle or squircle).
// @napi-rs/canvas is already in node_modules (it came with pdfjs-dist).
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/icons');
mkdirSync(OUT, { recursive: true });

const INK = '#0f1729';
function icon(size) {
  const c = createCanvas(size, size);
  const g = c.getContext('2d');
  g.fillStyle = INK;
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  // Sized so "KUI" spans 56% of the width, centred on its cap height.
  let px = size * 0.4;
  g.font = `700 ${px}px "Segoe UI", Arial, Helvetica, sans-serif`;
  const w = g.measureText('KUI').width;
  px = px * (size * 0.56) / w;
  g.font = `700 ${px}px "Segoe UI", Arial, Helvetica, sans-serif`;
  const m = g.measureText('KUI');
  const capH = m.actualBoundingBoxAscent;
  g.fillText('KUI', size / 2, size / 2 + capH / 2);
  return c.toBuffer('image/png');
}

for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  writeFileSync(join(OUT, name), icon(size));
  console.log('wrote public/icons/' + name, size + 'x' + size);
}

// An .ico is a directory of images; PNG frames are valid in it. Header, one
// 16-byte entry per frame, then the frames.
const frames = [16, 32].map((n) => ({ n, png: icon(n) }));
const head = Buffer.alloc(6 + 16 * frames.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(frames.length, 4);
let offset = head.length;
frames.forEach(({ n, png }, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(n, e); head.writeUInt8(n, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
writeFileSync(join(ROOT, 'public/favicon.ico'), Buffer.concat([head, ...frames.map((f) => f.png)]));
console.log('wrote public/favicon.ico 16x16 + 32x32');
