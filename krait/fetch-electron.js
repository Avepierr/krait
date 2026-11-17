'use strict';
// fetch-electron.js <electron-package-dir> <arch>
// Downloads the electron zip for <arch> (via @electron/get, resolved next to the package)
// and replaces <electronDir>\dist with its contents. Writes path.txt like electron's own installer.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [, , elDir, arch, verOverride] = process.argv;
if (!elDir || !arch) { console.error('usage: node fetch-electron.js <electron-dir> <arch> [version]'); process.exit(1); }

let getDir = path.join(elDir, 'node_modules', '@electron', 'get');
if (!fs.existsSync(getDir)) getDir = path.join(path.dirname(elDir), '@electron', 'get');
// require the entry FILE - @electron/get 5.x has no "main", so folder-require fails
const { downloadArtifact } = require(path.join(getDir, 'dist', 'index.js'));
const version = verOverride || require(path.join(elDir, 'package.json')).version;

(async () => {
  console.log('electron ' + version + ' (' + arch + ') downloading...');
  const zip = await downloadArtifact({ version, artifactName: 'electron', platform: 'win32', arch });
  console.log('zip: ' + zip);
  const dist = path.join(elDir, 'dist');
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  const tmp = path.join(elDir, 'arch-zip-' + arch);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${tmp}' -Force`], { stdio: 'inherit' });
  for (const f of fs.readdirSync(tmp)) {
    fs.renameSync(path.join(tmp, f), path.join(dist, f));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(path.join(elDir, 'path.txt'), 'electron.exe');
  if (!fs.existsSync(path.join(dist, 'electron.exe'))) throw new Error('electron.exe missing after extract');
  console.log('dist swapped to ' + arch + ' OK');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
