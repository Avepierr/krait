'use strict';
/**
 * make-ico.js — builds a REAL Windows .ico from assets/icon.png.
 * Run with Electron (needs nativeImage to resize):
 *     node_modules\electron\dist\electron.exe make-ico.js
 *
 * Windows only accepts icons up to 256x256. We write:
 *   - 16, 24, 32, 48, 64, 128 as classic BMP (DIB) entries  → crisp in Explorer/taskbar
 *   - 256 as PNG entry                                      → large icon views
 */
const fs = require('fs');
const path = require('path');

const { app, nativeImage } = require('electron');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'assets', 'icon.png');
const out = path.join(root, 'assets', 'krait.ico');

function dibEntry(img, size) {
  // Electron gives BGRA top-down; ICO expects BGRA bottom-up + an AND mask.
  const buf = img.toBitmap();
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);            // biSize
  header.writeInt32LE(size, 4);           // biWidth
  header.writeInt32LE(size * 2, 8);       // biHeight (XOR + AND)
  header.writeUInt16LE(1, 12);            // biPlanes
  header.writeUInt16LE(32, 14);           // biBitCount
  header.writeUInt32LE(0, 16);            // biCompression (BI_RGB)
  header.writeUInt32LE(size * size * 4, 20); // biSizeImage

  const rowBytes = size * 4;
  const pixels = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) {
    buf.copy(pixels, y * rowBytes, (size - 1 - y) * rowBytes, (size - y) * rowBytes);
  }

  // AND mask: 1 bit/pixel, rows padded to 4 bytes; all 0 = fully opaque
  const maskRow = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRow * size, 0);

  return Buffer.concat([header, pixels, mask]);
}

app.whenReady().then(() => {
  const base = nativeImage.createFromPath(src);
  if (base.isEmpty()) {
    console.error('Cannot read', src);
    app.quit();
    return;
  }

  const entries = [];
  for (const size of [16, 24, 32, 48, 64, 128]) {
    const img = base.resize({ width: size, height: size, quality: 'best' });
    entries.push({ size, data: dibEntry(img, size), png: false });
  }
  // 256 is stored as PNG (allowed and standard for .ico)
  const big = base.resize({ width: 256, height: 256, quality: 'best' });
  entries.push({ size: 256, data: big.toPNG(), png: true });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir.writeUInt8(e.size === 256 ? 0 : e.size, o + 0); // width
    dir.writeUInt8(e.size === 256 ? 0 : e.size, o + 1); // height
    dir.writeUInt8(0, o + 2);                            // palette
    dir.writeUInt8(0, o + 3);                            // reserved
    dir.writeUInt16LE(1, o + 4);                         // planes
    dir.writeUInt16LE(32, o + 6);                        // bpp
    dir.writeUInt32LE(e.data.length, o + 8);             // bytes
    dir.writeUInt32LE(offset, o + 12);                   // offset
    offset += e.data.length;
  });

  fs.writeFileSync(out, Buffer.concat([header, dir, ...entries.map(e => e.data)]));
  const st = fs.statSync(out);
  console.log('ICO written:', out, st.size, 'bytes,', entries.length, 'sizes (16-256)');
  app.quit();
});
