import assert from 'node:assert/strict';
import { createDrive, DriveError, KEEP, WEEK_MS, RETRY_MS, FOLDER_NAME } from '../app/src/main/assets/public/js/drive.js';
let T = 1_760_000_000_000; const now = () => T; const HOUR = 36e5, DAY = 864e5;
const mkKv = () => { const m = new Map(); return { m, get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => { m.set(k, v); }, remove: async (k) => { m.delete(k); } }; };
/* ---- fake Google ---- */
function fakeGoogle() {
  const g = { files: new Map(), nextId: 1, tokens: new Map(), approvedAfter: 2, polls: 0, slowDownOnce: false, deny: false, offline: false, revoked: [], refreshValid: true, tokenTtl: 3600, calls: [], forceExpire: false };
  g.postForm = async (url, b) => {
    if (g.offline) throw new TypeError('Failed to fetch'); g.calls.push(url);
    if (url.endsWith('/device/code')) return b.client_id === 'good.apps.googleusercontent.com' ? { status: 200, json: { device_code: 'DEV', user_code: 'ABCD-EFGH', verification_url: 'https://www.google.com/device', expires_in: 1800, interval: 5 } } : { status: 401, json: { error: 'invalid_client', error_description: 'The OAuth client was not found.' } };
    if (url.endsWith('/revoke')) { g.revoked.push(b.token); return { status: 200, json: {} }; }
    if (b.grant_type === 'refresh_token') { if (!g.refreshValid || b.refresh_token !== 'REFRESH') return { status: 400, json: { error: 'invalid_grant' } }; const t = 'at' + g.nextId++; g.tokens.set(t, T + g.tokenTtl * 1000); return { status: 200, json: { access_token: t, expires_in: g.tokenTtl } }; }
    g.polls++; if (g.deny) return { status: 400, json: { error: 'access_denied' } };
    if (g.slowDownOnce) { g.slowDownOnce = false; return { status: 400, json: { error: 'slow_down' } }; }
    if (g.polls <= g.approvedAfter) return { status: 428, json: { error: 'authorization_pending' } };
    const t = 'at' + g.nextId++; g.tokens.set(t, T + g.tokenTtl * 1000); return { status: 200, json: { access_token: t, refresh_token: 'REFRESH', expires_in: g.tokenTtl } };
  };
  const resp = (status, obj, text) => ({ ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => text ?? JSON.stringify(obj) });
  g.fetch = async (url, o = {}) => {
    if (g.offline) throw new TypeError('Failed to fetch'); g.calls.push(o.method || 'GET');
    const auth = (o.headers?.Authorization || '').replace('Bearer ', ''); const exp = g.tokens.get(auth);
    if (!exp || exp < T || g.forceExpire) { g.forceExpire = false; return resp(401, { error: { message: 'Invalid Credentials' } }); }
    const u = new URL(url), method = o.method || 'GET', path = u.pathname;
    if (path === '/upload/drive/v3/files' && method === 'POST') {
      const parts = o.body.split(/--htb[a-z0-9]+/).filter((p) => p.trim() && p.trim() !== '--'); const meta = JSON.parse(parts[0].split('\r\n\r\n')[1].trim()), content = parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
      assert.ok(o.headers['Content-Type'].startsWith('multipart/related; boundary=htb'));
      const id = 'f' + g.nextId++; g.files.set(id, { id, name: meta.name, parents: meta.parents, mimeType: meta.mimeType, content, created: T, seq: g.nextId, trashed: false }); return resp(200, { id, name: meta.name, createdTime: new Date(T).toISOString() });
    }
    if (path === '/drive/v3/files' && method === 'POST') { const b = JSON.parse(o.body), id = 'd' + g.nextId++; g.files.set(id, { id, name: b.name, mimeType: b.mimeType, parents: [], created: T, seq: g.nextId, trashed: false }); return resp(200, { id }); }
    if (path === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q'); let r = [...g.files.values()].filter((f) => !f.trashed);
      if (q.includes('mimeType=')) r = r.filter((f) => f.mimeType === 'application/vnd.google-apps.folder' && q.includes(`name='${f.name}'`));
      else { const pid = q.match(/'([^']+)' in parents/)[1]; r = r.filter((f) => f.parents?.includes(pid)).sort((a, b) => b.created - a.created || b.seq - a.seq); }
      return resp(200, { files: r.map((f) => ({ id: f.id, name: f.name, createdTime: new Date(f.created).toISOString(), size: String(f.content?.length || 0) })) });
    }
    const m = path.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (m) { const f = g.files.get(decodeURIComponent(m[1])); if (!f) return resp(404, { error: { message: 'File not found' } });
      if (method === 'DELETE') { g.files.delete(f.id); return resp(204, {}); }
      if (u.searchParams.get('alt') === 'media') return resp(200, null, f.content); return resp(200, { id: f.id, trashed: f.trashed }); }
    return resp(404, { error: { message: 'unhandled ' + path } });
  };
  return g;
}
const setup = async (opts = {}) => { const g = fakeGoogle(), kv = mkKv(); const d = createDrive({ kv, fetch: g.fetch, postForm: g.postForm, now, sleep: async (ms) => { T += ms; }, ...opts }); return { g, kv, d }; };
const connect = async (ctx) => { await ctx.d.setCredentials('good.apps.googleusercontent.com', 'sec'); await ctx.d.pollAuth(await ctx.d.startAuth()); };
const expectErr = async (p, code) => { try { await p; assert.fail('should have thrown'); } catch (e) { assert.ok(e instanceof DriveError, String(e)); assert.equal(e.code, code, e.message); } };
let n = 0; const t = async (name, f) => { T = 1_760_000_000_000; await f(); n++; console.log('ok', name); };

await t('credentials: required, trimmed, stored; changing client clears the old sign-in', async () => {
  const { d, kv } = await setup(); await expectErr(d.setCredentials('', 'x'), 'config'); await expectErr(d.setCredentials('id', ''), 'config');
  await d.setCredentials('  good.apps.googleusercontent.com ', ' sec '); const s = await d.status(); assert.deepEqual([s.configured, s.connected, s.clientId, s.hasSecret, s.auto], [true, false, 'good.apps.googleusercontent.com', true, true]);
  assert.ok(JSON.parse(kv.m.get('drive')).clientSecret === 'sec'); await d.setCredentials('good.apps.googleusercontent.com', ''); assert.equal((await d.status()).hasSecret, true, 'blank secret keeps the saved one');
});
await t('sign-in: waits through pending + slow_down, then connects', async () => {
  const ctx = await setup(); ctx.g.slowDownOnce = true; await ctx.d.setCredentials('good.apps.googleusercontent.com', 'sec'); const a = await ctx.d.startAuth(); assert.equal(a.userCode, 'ABCD-EFGH'); assert.equal(a.url, 'https://www.google.com/device');
  const t0 = T; assert.equal(await ctx.d.pollAuth(a), true); assert.ok((await ctx.d.status()).connected); assert.ok(T - t0 >= 5000 * 3 + 5000, 'slow_down added 5 s to the interval');
});
await t('sign-in failures: wrong client, denied, expired, cancelled, offline', async () => {
  let c = await setup(); await c.d.setCredentials('bad-id', 's'); await expectErr(c.d.startAuth(), 'client');
  c = await setup(); c.g.deny = true; await c.d.setCredentials('good.apps.googleusercontent.com', 's'); await expectErr(c.d.pollAuth(await c.d.startAuth()), 'denied');
  c = await setup(); c.g.approvedAfter = 1e9; await c.d.setCredentials('good.apps.googleusercontent.com', 's'); await expectErr(c.d.pollAuth(await c.d.startAuth()), 'expired');
  c = await setup(); await c.d.setCredentials('good.apps.googleusercontent.com', 's'); const a = await c.d.startAuth(); await expectErr(c.d.pollAuth(a, () => true), 'cancelled');
  c = await setup(); await c.d.setCredentials('good.apps.googleusercontent.com', 's'); c.g.offline = true; await expectErr(c.d.startAuth(), 'network');
});
await t('backup: creates the folder once, uploads the exact JSON, reuses folder', async () => {
  const c = await setup(); await connect(c); const data = JSON.stringify({ habits: [], tasks: [], note: 'line1\r\n--htb--tricky "quotes" ✓' }, null, 1);
  const r = await c.d.backup(data); assert.match(r.name, /^habit-task-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
  const folders = [...c.g.files.values()].filter((f) => f.mimeType.includes('folder')); assert.equal(folders.length, 1); assert.equal(folders[0].name, FOLDER_NAME);
  T += 60000; await c.d.backup(data); assert.equal([...c.g.files.values()].filter((f) => f.mimeType.includes('folder')).length, 1, 'folder reused');
  const ls = await c.d.list(); assert.equal(ls.length, 2); assert.ok(ls[0].created >= ls[1].created, 'newest first'); assert.equal(await c.d.download(ls[0].id), data, 'round trip is byte-exact');
  assert.equal((await c.d.status()).last, T);
});
await t('retention keeps only the newest 8 backups', async () => {
  const c = await setup(); await connect(c); for (let i = 0; i < 11; i++) { T += DAY; await c.d.backup(JSON.stringify({ i })); }
  const ls = await c.d.list(); assert.equal(ls.length, KEEP); assert.equal(JSON.parse(await c.d.download(ls[0].id)).i, 10); assert.equal(JSON.parse(await c.d.download(ls.at(-1).id)).i, 3);
});
await t('token refresh: reuses a valid token, refreshes an expired one, retries once on 401', async () => {
  const c = await setup(); await connect(c); await c.d.backup('{}'); const before = c.g.calls.filter((x) => x.endsWith('/token')).length; T += 30000; await c.d.backup('{}');
  assert.equal(c.g.calls.filter((x) => x.endsWith('/token')).length, before, 'no refresh while token valid');
  T += 3600 * 1000; await c.d.backup('{}'); assert.ok(c.g.calls.filter((x) => x.endsWith('/token')).length > before, 'refreshed after expiry');
  c.g.forceExpire = true; await c.d.backup('{}'); // server says 401 once -> transparent retry
});
await t('revoked access (invalid_grant) -> reconnect required and status updates', async () => {
  const c = await setup(); await connect(c); T += 4000 * 1000; c.g.refreshValid = false; await expectErr(c.d.backup('{}'), 'reconnect'); const s = await c.d.status(); assert.equal(s.connected, false); assert.equal(s.configured, true);
});
await t('trashed folder is recreated', async () => {
  const c = await setup(); await connect(c); await c.d.backup('{}'); for (const f of c.g.files.values()) if (f.mimeType.includes('folder')) f.trashed = true;
  await c.d.backup('{}'); assert.equal([...c.g.files.values()].filter((f) => f.mimeType.includes('folder') && !f.trashed).length, 1);
});
await t('weekly schedule: due after 7 days, not before, respects auto off / not connected / empty data', async () => {
  const c = await setup(); assert.equal(await c.d.isDue(), false, 'not connected'); await connect(c);
  assert.equal(await c.d.isDue(), true, 'connected, never backed up'); let r = await c.d.autoBackup(() => '{"habits":[1]}'); assert.deepEqual([r.ran, r.ok], [true, true]);
  T += 6 * DAY; assert.equal(await c.d.isDue(), false); assert.equal((await c.d.autoBackup(() => '{}')).ran, false);
  T += DAY + 1000; assert.equal(await c.d.isDue(), true); await c.d.setAuto(false); assert.equal(await c.d.isDue(), false); await c.d.setAuto(true);
  r = await c.d.autoBackup(() => '{}', () => true); assert.deepEqual([r.ran, r.skipped], [false, 'empty']);
  assert.equal((await c.d.autoBackup(() => '{"x":1}')).ok, true); assert.equal(await c.d.isDue(), false, 'next backup is a week later');
});
await t('offline during the weekly backup: error is recorded and the retry is throttled to 6 hours', async () => {
  const c = await setup(); await connect(c); await c.d.backup('{}'); T += 8 * DAY; c.g.offline = true;
  let r = await c.d.autoBackup(() => '{"a":1}'); assert.deepEqual([r.ran, r.ok, r.code], [true, false, 'network']); assert.equal((await c.d.status()).lastError, 'No internet connection');
  c.g.offline = false; T += HOUR; assert.equal(await c.d.isDue(), false, 'too soon to retry'); T += RETRY_MS; assert.equal(await c.d.isDue(), true);
  r = await c.d.autoBackup(() => '{"a":1}'); assert.equal(r.ok, true); assert.equal((await c.d.status()).lastError, '');
});
await t('disconnect revokes the token and clears sign-in but keeps credentials; forget wipes everything', async () => {
  const c = await setup(); await connect(c); await c.d.backup('{}'); await c.d.disconnect(); assert.deepEqual(c.g.revoked, ['REFRESH']); let s = await c.d.status(); assert.deepEqual([s.connected, s.configured], [false, true]);
  await expectErr(c.d.backup('{}'), 'noauth'); await c.d.forget(); s = await c.d.status(); assert.deepEqual([s.configured, s.clientId], [false, '']); assert.equal(c.kv.m.has('drive'), false);
});
await t('corrupt stored config does not crash', async () => { const c = await setup(); c.kv.m.set('drive', '{not json'); assert.equal((await c.d.status()).configured, false); });
console.log(n, 'drive tests passed');
