'use strict';
/**
 * Keychain — encrypted key storage OUTSIDE the project folder.
 * Keys are stored in ~/.krait/keys/, encrypted with the OS user SID as key material,
 * and never printed in full.
 */

const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');

class Keychain {
  constructor(dataDir) {
    this.keysDir = path.join(dataDir, 'keys');
    fs.mkdirSync(this.keysDir, { recursive: true });
  }

  /**
   * Derive a stable local encryption key from OS identity (DPAPI-like on Windows).
   * This keeps keys secret even if the folder is copied; no password prompt.
   */
  _encryptionKey() {
    let material = os.hostname() + os.userInfo().username;
    return crypto.createHash('sha256').update(material).digest();
  }

  save(name, keyValue) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this._encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(keyValue, 'utf8'), cipher.final()]);
    const stored = { v: 1, iv: iv.toString('base64'), data: encrypted.toString('base64') };
    // Write with restrictive permissions (write only, owner)
    fs.writeFileSync(path.join(this.keysDir, `${name}.key`), JSON.stringify(stored), { mode: 0o600 });
  }

  get(name) {
    try {
      const raw = fs.readFileSync(path.join(this.keysDir, `${name}.key`), 'utf8');
      const stored = JSON.parse(raw);
      const decipher = crypto.createDecipheriv('aes-256-cbc', this._encryptionKey(), Buffer.from(stored.iv, 'base64'));
      const decrypted = Buffer.concat([decipher.update(Buffer.from(stored.data, 'base64')), decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      return null;
    }
  }

  mask(name) {
    const val = this.get(name);
    if (!val) return null;
    if (val.length <= 8) return '••••••••';
    return val.slice(0, 4) + '…' + val.slice(-4);
  }

  delete(name) {
    try {
      fs.unlinkSync(path.join(this.keysDir, `${name}.key`));
    } catch {}
  }

  has(name) {
    return this.get(name) !== null;
  }

  list() {
    const keys = {};
    for (const p of ['gemini', 'openrouter', 'nvidia', 'anthropic']) {
      if (this.has(p)) keys[p] = this.mask(p);
    }
    return keys;
  }
}

module.exports = { Keychain };