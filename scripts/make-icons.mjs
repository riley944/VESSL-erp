// One-off: the iPad view's home-screen and manifest icons -- a square "KUI"
// monogram, white on the app's ink (#0f1729). public/logo.png is a 1288x240
// wordmark, unreadable at 180px, so the icon is drawn rather than resized.
//
//   node scripts/make-icons.mjs
//
// Writes public/icons/apple-touch-icon.png (180), icon-192.png and
// icon-512.png. The letters sit inside the middle 60%, so the 192 and 512 can
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
