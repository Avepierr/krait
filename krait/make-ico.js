'use strict';
/**
 * make-ico.js — wraps assets/icon.png into a real Windows .ico file
 * (ICO format supports PNG-compressed images directly).
 * Usage: node make-ico.js  → writes assets/krait.ico
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pngPath = path.join(root, 'assets', 'icon.png');
const icoPath = path.join(root, 'assets', 'krait.ico');

const png = fs.readFileSync(pngPath);
// read width/height from PNG header (bytes 16-23, big-endian)
const w = png.readUInt32BE(16);
const h = png.readUInt32BE(20);
const size = Math.min(w, 255) || 255;

const header = Buffer.alloc(6, 0);
header.writeUInt16LE(0, 0);      // reserved
header.writeUInt16LE(1, 2);      // type: icon
header.writeUInt16LE(1, 4);      // count

const entry = Buffer.alloc(16, 0);
entry.writeUInt8(size === 256 ? 0 : size, 0);  // width (0 = 256)
entry.writeUInt8(size === 256 ? 0 : size, 1);  // height
entry.writeUInt8(0, 2);          // palette
entry.writeUInt8(0, 3);          // reserved
entry.writeUInt16LE(1, 4);       // planes
entry.writeUInt16LE(32, 6);      // bpp
entry.writeUInt32LE(png.length, 8); // data size
entry.writeUInt32LE(22, 12);     // offset

const ico = Buffer.concat([header, entry, png]);
fs.writeFileSync(icoPath, ico);
console.log('ICO written:', icoPath, '(' + ico.length + ' bytes, source ' + w + 'x' + h + ')');
