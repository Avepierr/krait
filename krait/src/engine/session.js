'use strict';
/**
 * Session store — saves/loads conversations as JSONL transcripts.
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

class SessionStore {
  constructor(dataDir) {
    this.sessionsDir = path.join(dataDir, 'sessions');
    fs.mkdirSync(this.sessionsDir, { recursive: true });
  }

  create(name) {
    const id = crypto.randomUUID();
    const sessionPath = path.join(this.sessionsDir, `${id}.jsonl`);
    const meta = { id, name: name || 'untitled', created: Date.now(), updated: Date.now() };
    fs.writeFileSync(sessionPath, '', 'utf8');
    fs.writeFileSync(path.join(this.sessionsDir, `${id}.meta`), JSON.stringify(meta));
    return meta;
  }

  append(id, message) {
    const sessionPath = path.join(this.sessionsDir, `${id}.jsonl`);
    fs.appendFileSync(sessionPath, JSON.stringify({ ...message, at: Date.now() }) + '\n');
    const metaPath = path.join(this.sessionsDir, `${id}.meta`);
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      meta.updated = Date.now();
      fs.writeFileSync(metaPath, JSON.stringify(meta));
    } catch {}
  }

  load(id) {
    const sessionPath = path.join(this.sessionsDir, `${id}.jsonl`);
    if (!fs.existsSync(sessionPath)) return null;
    const lines = fs.readFileSync(sessionPath, 'utf8').split('\n').filter(Boolean);
    return lines.map(l => JSON.parse(l));
  }

  list() {
    const files = fs.readdirSync(this.sessionsDir).filter(f => f.endsWith('.meta'));
    return files.map(f => JSON.parse(fs.readFileSync(path.join(this.sessionsDir, f), 'utf8'))).sort((a, b) => b.updated - a.updated);
  }

  latest() {
    const all = this.list();
    return all.length > 0 ? all[0] : null;
  }

  delete(id) {
    try {
      fs.unlinkSync(path.join(this.sessionsDir, `${id}.jsonl`));
      fs.unlinkSync(path.join(this.sessionsDir, `${id}.meta`));
    } catch {}
  }
}

module.exports = { SessionStore };