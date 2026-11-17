'use strict';
// run-schema.js - execute schema.sql against the Supabase Management API,
// statement by statement ($$-aware splitter), logging each result.
const fs = require('fs');
const PROJECT = 'kxvjffaupmkegemmcsex';
const pat = fs.readFileSync('C:/Users/karre/OneDrive/Desktop/token.txt', 'utf8').trim();
const sql = fs.readFileSync('C:/Users/karre/OneDrive/Desktop/REA-OpenCode/krait/backend/schema.sql', 'utf8');

// split into statements: respect dollar-quoted bodies and -- comments
function splitStatements(src) {
  const out = [];
  let cur = '', inDollar = false, dollarTag = '';
  const lines = src.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inDollar && trimmed.startsWith('--')) continue; // full-line comment
    let i = 0;
    while (i < line.length) {
      if (inDollar) {
        if (line.startsWith(dollarTag, i)) { inDollar = false; cur += dollarTag; i += dollarTag.length; continue; }
        cur += line[i]; i++; continue;
      }
      if (line[i] === '$') {
        const m = /^(\$[A-Za-z0-9_]*\$)/.exec(line.slice(i));
        if (m) { inDollar = true; dollarTag = m[1]; cur += m[1]; i += m[1].length; continue; }
      }
      cur += line[i];
      i++;
    }
    cur += '\n';
    if (!inDollar && cur.trim().endsWith(';')) {
      const stmt = cur.trim().slice(0, -1).trim();
      if (stmt) out.push(stmt);
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

(async () => {
  const stmts = splitStatements(sql);
  console.log('statements: ' + stmts.length);
  let ok = 0, fail = 0;
  for (let i = 0; i < stmts.length; i++) {
    let s = stmts[i];
    const pm = /^create policy\s+("[^"]+")\s+on\s+([\w.]+)/.exec(s);
    if (pm) {
      // policies aren't idempotent - drop first
      const drop = `drop policy if exists ${pm[1]} on ${pm[2]}`;
      try {
        await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + pat, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: drop }),
        });
      } catch {}
    }
    const label = s.split('\n')[0].slice(0, 60);
    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + pat, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: s }),
      });
      const text = await res.text();
      if (res.ok) { ok++; console.log(`[${i + 1}] OK   ${label}`); }
      else if (/already (a )?member|already exists in publication/.test(text)) { ok++; console.log(`[${i + 1}] OK   ${label} (already in publication)`); }
      else { fail++; console.log(`[${i + 1}] FAIL ${res.status} ${label}\n      ${text.slice(0, 300)}`); }
    } catch (e) {
      fail++;
      console.log(`[${i + 1}] NETERR ${label}: ${e.message}`);
    }
  }
  console.log(`done: ${ok} ok, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
