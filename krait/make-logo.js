'use strict';
/**
 * make-logo.js — crops the snake logo: removes the near-white background,
 * trims to the snake's bounding box, pads to a square, saves:
 *   assets/logo-trim.png  (for ICO building)
 * Run with Electron:  node_modules\electron\dist\electron.exe make-logo.js
 */
const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'assets', 'icon.png');
const outPng = path.join(root, 'assets', 'logo-trim.png');

app.whenReady().then(() => {
  const base = nativeImage.createFromPath(src);
  if (base.isEmpty()) { console.error('cannot read', src); app.quit(); return; }

  const size = base.getSize().width;
  const buf = base.toBitmap(); // BGRA
  const px = (x, y) => {
    const i = (y * size + x) * 4;
    return { b: buf[i], g: buf[i + 1], r: buf[i + 2], a: buf[i + 3] };
  };

  // 1. kill near-white background (and near-white anti-alias fringe)
  for (let i = 0; i < buf.length; i += 4) {
    const b = buf[i], g = buf[i + 1], r = buf[i + 2];
    if (r > 232 && g > 232 && b > 232) buf[i + 3] = 0;
  }
  let img = nativeImage.createFromBitmap(buf, { width: size, height: size });

  // 2. bounding box of visible pixels
  const b2 = img.toBitmap();
  const A = (x, y) => b2[(y * size + x) * 4 + 3];
  let minX = size, minY = size, maxX = -1, maxY = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (A(x, y) > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) { console.error('image fully transparent?'); app.quit(); return; }

  // 3. crop with a little padding, square around the longer side
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const pad = Math.round(Math.max(w, h) * 0.06);
  const side = Math.max(w, h) + pad * 2;
  const cx = Math.round((minX + maxX) / 2), cy = Math.round((minY + maxY) / 2);
  let sx = cx - Math.round(side / 2), sy = cy - Math.round(side / 2);

  // build a new square canvas by hand (BGRA, transparent padding)
  const out = Buffer.alloc(side * side * 4, 0);
  for (let y = 0; y < side; y++) {
    const fy = sy + y;
    if (fy < 0 || fy >= size) continue;
    for (let x = 0; x < side; x++) {
      const fx = sx + x;
      if (fx < 0 || fx >= size) continue;
      const si = (fy * size + fx) * 4, di = (y * side + x) * 4;
      out[di] = b2[si]; out[di + 1] = b2[si + 1]; out[di + 2] = b2[si + 2]; out[di + 3] = b2[si + 3];
    }
  }
  const cropped = nativeImage.createFromBitmap(out, { width: side, height: side });
  fs.writeFileSync(outPng, cropped.toPNG());
  console.log('logo trimmed:', outPng, side + 'x' + side, '(was', size + 'x' + size + ')');
  app.quit();
});
