'use strict';
/**
 * krait-cloud.js - krait's optional online layer (plain JS, no SDK, no build step).
 *
 * Talks to the krait Supabase project directly with fetch:
 *   - accounts: email + password sign up / sign in / refresh / sign out
 *   - profiles: username, display name, is_admin, banned (server-enforced)
 *   - sync:     threads (chats) per account
 *   - showcase: posts, likes, reports
 *   - admin:    owner-only actions are enforced by the DATABASE, not here -
 *               these helpers just call the same endpoints the rules protect.
 *
 * The publishable key is public by design. Your API keys for model providers
 * never touch this file or the network layer here - they stay in ~/.krait/keys.
 */
(function (root) {
  const SUPABASE_URL = 'https://kxvjffaupmkegemmcsex.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_IjXUzZND4FZZ2BQeSPlMtQ_ofub3FDg';
  const SESSION_KEY = 'krait-cloud-session';

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }
  function writeSession(s) {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  }
  function session() { return readSession(); }
  function signedIn() { const s = readSession(); return !!(s && s.access_token); }
  function currentUser() { const s = readSession(); return s && s.user ? s.user : null; }

  function headers(token) {
    const h = { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }

  async function call(path, opts) {
    opts = opts || {};
    const h = headers(opts.token);
    if (opts.prefer) h.Prefer = opts.prefer;
    const res = await fetch(SUPABASE_URL + path, {
      method: opts.method || 'GET',
      headers: h,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeout || 20000),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = (data && (data.msg || data.message || data.error_description || data.error)) || ('HTTP ' + res.status);
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ── auth ──
  async function signUp(email, password, username, displayName) {
    const data = await call('/auth/v1/signup', {
      method: 'POST',
      body: { email, password, data: { username, display_name: displayName || username } },
    });
    if (!data || !data.access_token) throw new Error('Account made - check your email to confirm, then sign in.');
    writeSession(data);
    return data.user;
  }

  async function signIn(email, password) {
    const data = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    writeSession(data);
    return data.user;
  }

  async function refresh() {
    const s = readSession();
    if (!s || !s.refresh_token) return null;
    try {
      const data = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } });
      writeSession(data);
      return data.user;
    } catch { writeSession(null); return null; }
  }

  async function signOut() {
    const s = readSession();
    if (s && s.access_token) {
      try { await call('/auth/v1/logout', { method: 'POST', token: s.access_token }); } catch {}
    }
    writeSession(null);
  }

  async function token() {
    const s = readSession();
    if (!s || !s.access_token) return null;
    // JWT exp check - refresh a minute early
    try {
      const payload = JSON.parse(atob(s.access_token.split('.')[1]));
      if (payload.exp * 1000 - 60000 < Date.now()) { await refresh(); return (readSession() || {}).access_token || null; }
    } catch {}
    return s.access_token;
  }

  // ── profile ──
  async function myProfile() {
    const t = await token();
    if (!t) return null;
    const rows = await call('/rest/v1/profiles?select=*', { token: t });
    return rows && rows[0] ? rows[0] : null;
  }

  async function updateProfile(fields) {
    const t = await token();
    if (!t) throw new Error('Not signed in.');
    const me = currentUser();
    await call('/rest/v1/profiles?id=eq.' + me.id, { method: 'PATCH', token: t, body: fields });
    return true;
  }

  // ── chat sync ──
  async function saveThread(thread) {
    const t = await token();
    if (!t) return null;
    const me = currentUser();
    const body = {
      user_id: me.id,
      title: thread.title || 'chat',
      messages: thread.messages || [],
      updated_at: new Date().toISOString(),
    };
    if (thread.id) {
      await call('/rest/v1/threads?id=eq.' + thread.id, { method: 'PATCH', token: t, body });
      return thread.id;
    }
    const rows = await call('/rest/v1/threads?select=id', {
      method: 'POST', token: t, body, prefer: 'return=representation',
    });
    return rows && rows[0] ? rows[0].id : null;
  }

  async function listThreads() {
    const t = await token();
    if (!t) return [];
    return call('/rest/v1/threads?select=id,title,updated_at&order=updated_at.desc&limit=200', { token: t });
  }

  async function loadThread(id) {
    const t = await token();
    if (!t) return null;
    const rows = await call('/rest/v1/threads?select=*&id=eq.' + encodeURIComponent(id), { token: t });
    return rows && rows[0] ? rows[0] : null;
  }

  // ── showcase ──
  async function profilesById(ids) {
    // no FK between showcase tables and profiles (both point at auth.users),
    // so author names are fetched with an in.(...) query and merged in JS
    const t = await token();
    const uniq = Array.from(new Set(ids.filter(Boolean)));
    if (!t || !uniq.length) return {};
    const rows = await call('/rest/v1/profiles?select=id,username,display_name&id=in.(' + uniq.join(',') + ')', { token: t });
    const map = {};
    (rows || []).forEach(r => { map[r.id] = r; });
    return map;
  }

  async function listShowcase(limit) {
    const t = await token();
    if (!t) throw new Error('Sign in to browse the Showcase.');
    const posts = await call('/rest/v1/showcase_posts?select=*&removed=eq.false&order=created_at.desc&limit=' + (limit || 50), { token: t });
    const authors = await profilesById((posts || []).map(p => p.user_id));
    return (posts || []).map(p => Object.assign({}, p, { author: authors[p.user_id] || null }));
  }

  async function sharePost(post) {
    const t = await token();
    if (!t) throw new Error('Sign in to share.');
    const me = currentUser();
    const rows = await call('/rest/v1/showcase_posts?select=id', {
      method: 'POST', token: t, prefer: 'return=representation',
      body: {
        user_id: me.id,
        title: String(post.title || 'untitled').slice(0, 120),
        body: String(post.body || '').slice(0, 20000),
        kind: post.kind || 'chat',
        tags: post.tags || [],
        payload: post.payload || {},
      },
    });
    return rows && rows[0] ? rows[0].id : null;
  }

  async function likePost(postId) {
    const t = await token();
    if (!t) throw new Error('Sign in to like.');
    const me = currentUser();
    await call('/rest/v1/showcase_likes', { method: 'POST', token: t, body: { post_id: postId, user_id: me.id } });
    return true;
  }

  async function unlikePost(postId) {
    const t = await token();
    if (!t) return false;
    const me = currentUser();
    await call('/rest/v1/showcase_likes?post_id=eq.' + postId + '&user_id=eq.' + me.id, { method: 'DELETE', token: t });
    return true;
  }

  // ── reports ──
  async function report(target) {
    const t = await token();
    if (!t) throw new Error('Sign in to report.');
    if (!target.reason || !String(target.reason).trim()) throw new Error('Say what is wrong first.');
    const me = currentUser();
    await call('/rest/v1/reports', {
      method: 'POST', token: t,
      body: {
        reporter_id: me.id,
        target_post_id: target.postId || null,
        target_user_id: target.userId || null,
        reason: String(target.reason).slice(0, 2000),
      },
    });
    return true;
  }

  // ── admin (server enforces is_admin; these fail for anyone else) ──
  async function adminUsers() {
    const t = await token();
    if (!t) throw new Error('Not signed in.');
    return call('/rest/v1/profiles?select=*&order=created_at.desc&limit=500', { token: t });
  }

  async function adminSetBan(userId, banned, reason) {
    const t = await token();
    if (!t) throw new Error('Not signed in.');
    await call('/rest/v1/profiles?id=eq.' + userId, {
      method: 'PATCH', token: t,
      body: { banned: !!banned, ban_reason: banned ? String(reason || '') : null },
    });
    return true;
  }

  async function adminReports() {
    const t = await token();
    if (!t) throw new Error('Not signed in.');
    const rows = await call('/rest/v1/reports?select=*&order=created_at.desc&limit=200', { token: t });
    const who = await profilesById((rows || []).map(r => r.reporter_id));
    return (rows || []).map(r => Object.assign({}, r, { reporter: who[r.reporter_id] || null }));
  }

  async function adminCloseReport(id, status) {
    const t = await token();
    if (!t) throw new Error('Not signed in.');
    await call('/rest/v1/reports?id=eq.' + id, { method: 'PATCH', token: t, body: { status: status || 'closed' } });
    return true;
  }

  async function adminTakedown(postId, removed) {
    const t = await token();
    if (!t) throw new Error('Not signed in.');
    await call('/rest/v1/showcase_posts?id=eq.' + postId, { method: 'PATCH', token: t, body: { removed: !!removed } });
    return true;
  }

  const api = {
    SUPABASE_URL, PUBLISHABLE_KEY,
    session, signedIn, currentUser, signUp, signIn, signOut, refresh, token,
    myProfile, updateProfile,
    saveThread, listThreads, loadThread,
    listShowcase, sharePost, likePost, unlikePost, report,
    adminUsers, adminSetBan, adminReports, adminCloseReport, adminTakedown,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KraitCloud = api;
})(typeof window !== 'undefined' ? window : null);
