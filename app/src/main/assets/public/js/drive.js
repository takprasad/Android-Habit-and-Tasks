/* Google Drive backup without any SDK.
 * Sign-in: OAuth 2.0 "device flow" (user types a short code at google.com/device) - needs no redirect URI, no signing-key
 * fingerprint and no native code. Scope: drive.file only, so the app can see ONLY the files it created itself.
 * Storage: backups are plain JSON files in a Drive folder called "HabitTaskTracker Backups" (the newest KEEP are retained).
 * Everything is injected (kv, fetch, postForm, clock) so the whole flow is unit-testable with a fake Google. */
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DEVICE_URL = 'https://oauth2.googleapis.com/device/code', TOKEN_URL = 'https://oauth2.googleapis.com/token', REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/drive/v3', UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER_NAME = 'HabitTaskTracker Backups', KEEP = 8, WEEK_MS = 7 * 864e5, RETRY_MS = 6 * 36e5, MAX_BYTES = 50e6;

export class DriveError extends Error { constructor(code, message) { super(message); this.code = code; } }
const msgOf = (j, status) => (typeof j?.error === 'string' ? (j.error_description || j.error) : j?.error?.message) || `Google returned HTTP ${status}`;
const pad = (n) => String(n).padStart(2, '0');

export function createDrive({ kv, fetch: doFetch = (...a) => globalThis.fetch(...a), postForm, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let cfg = null, tok = null;
  const load = async () => { if (!cfg) { try { cfg = JSON.parse((await kv.get('drive')) || '{}') || {}; } catch { cfg = {}; } } return cfg; };
  const persist = () => kv.set('drive', JSON.stringify(cfg));
  const net = async (fn) => { try { return await fn(); } catch (e) { if (e instanceof DriveError) throw e; throw new DriveError('network', 'No internet connection'); } };
  const form = (url, body) => net(() => postForm(url, body)); // -> { status, json }

  async function status() {
    await load();
    return { configured: !!(cfg.clientId && cfg.clientSecret), connected: !!cfg.refresh, clientId: cfg.clientId || '', hasSecret: !!cfg.clientSecret, last: cfg.last || 0, lastName: cfg.lastName || '', lastError: cfg.lastError || '', auto: cfg.auto !== false };
  }
  async function setCredentials(clientId, clientSecret) {
    await load(); clientId = String(clientId || '').trim(); clientSecret = String(clientSecret || '').trim();
    if (!clientId) throw new DriveError('config', 'Enter your Google Client ID');
    if (!clientSecret && !cfg.clientSecret) throw new DriveError('config', 'Enter your Google Client secret');
    if (clientId !== cfg.clientId) { delete cfg.refresh; delete cfg.folderId; tok = null; }
    cfg.clientId = clientId; if (clientSecret) cfg.clientSecret = clientSecret; await persist();
  }
  async function setAuto(on) { await load(); cfg.auto = !!on; await persist(); }

  /* --- sign-in (device flow) --- */
  async function startAuth() {
    await load(); if (!cfg.clientId || !cfg.clientSecret) throw new DriveError('config', 'Save your Client ID and secret first');
    const { status: s, json: j } = await form(DEVICE_URL, { client_id: cfg.clientId, scope: SCOPE });
    if (s !== 200 || !j?.device_code) throw new DriveError(j?.error === 'invalid_client' ? 'client' : 'auth', msgOf(j, s));
    return { deviceCode: j.device_code, userCode: j.user_code, url: j.verification_url || j.verification_uri || 'https://www.google.com/device', interval: Math.max(1, j.interval || 5), expiresAt: now() + (j.expires_in || 1800) * 1000 };
  }
  async function pollAuth(auth, isCancelled = () => false) {
    let interval = auth.interval;
    while (now() < auth.expiresAt) {
      await sleep(interval * 1000); if (isCancelled()) throw new DriveError('cancelled', 'Cancelled');
      const { status: s, json: j } = await form(TOKEN_URL, { client_id: cfg.clientId, client_secret: cfg.clientSecret, device_code: auth.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
      if (s === 200 && j?.access_token) {
        if (!j.refresh_token) throw new DriveError('auth', 'Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and try again.');
        cfg.refresh = j.refresh_token; delete cfg.lastError; tok = { value: j.access_token, exp: now() + (j.expires_in || 3600) * 1000 }; await persist(); return true;
      }
      const e = j?.error;
      if (e === 'authorization_pending') continue;
      if (e === 'slow_down') { interval += 5; continue; }
      if (e === 'access_denied') throw new DriveError('denied', 'Access was denied');
      if (e === 'expired_token') break;
      throw new DriveError('auth', msgOf(j, s));
    }
    throw new DriveError('expired', 'The code expired. Please try again.');
  }
  async function accessToken() {
    await load(); if (tok && tok.exp - 60000 > now()) return tok.value;
    if (!cfg.refresh) throw new DriveError('noauth', 'Google Drive is not connected');
    const { status: s, json: j } = await form(TOKEN_URL, { client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: cfg.refresh, grant_type: 'refresh_token' });
    if (s === 200 && j?.access_token) { tok = { value: j.access_token, exp: now() + (j.expires_in || 3600) * 1000 }; return tok.value; }
    if (j?.error === 'invalid_grant') { delete cfg.refresh; delete cfg.folderId; tok = null; await persist(); throw new DriveError('reconnect', 'Google Drive access expired. Please reconnect.'); }
    throw new DriveError('auth', msgOf(j, s));
  }

  /* --- Drive REST --- */
  async function api(url, opts = {}, retry = true) {
    const t = await accessToken();
    const r = await net(() => doFetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t } }));
    if (r.status === 401 && retry) { tok = null; return api(url, opts, false); }
    return r;
  }
  const must = async (r) => { if (r.ok) return r; let j = {}; try { j = await r.json(); } catch { /* not json */ } throw new DriveError(r.status === 403 ? 'forbidden' : 'http', msgOf(j, r.status)); };
  const jsonOf = async (r) => { try { return await r.json(); } catch { return {}; } };

  async function ensureFolder() {
    await load();
    if (cfg.folderId) { const r = await api(`${API}/files/${encodeURIComponent(cfg.folderId)}?fields=id,trashed`); if (r.ok) { const j = await jsonOf(r); if (!j.trashed) return cfg.folderId; } cfg.folderId = ''; }
    const q = `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const found = await jsonOf(await must(await api(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`)));
    let id = found.files?.[0]?.id;
    if (!id) {
      const c = await jsonOf(await must(await api(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }) })));
      id = c.id; if (!id) throw new DriveError('http', 'Could not create the Drive folder');
    }
    cfg.folderId = id; await persist(); return id;
  }
  async function list() {
    const folder = await ensureFolder(), q = `'${folder}' in parents and trashed=false`;
    const j = await jsonOf(await must(await api(`${API}/files?q=${encodeURIComponent(q)}&orderBy=createdTime%20desc&pageSize=50&fields=files(id,name,createdTime,size)`)));
    return (j.files || []).map((f) => ({ id: f.id, name: f.name, created: Date.parse(f.createdTime) || 0, size: +f.size || 0 }));
  }
  async function prune() { const all = await list(); for (const f of all.slice(KEEP)) { try { await api(`${API}/files/${encodeURIComponent(f.id)}`, { method: 'DELETE' }); } catch { /* best effort */ } } }
  async function backup(text) {
    await load(); if (text.length > MAX_BYTES) throw new DriveError('toolarge', 'Data is too large to back up');
    const folder = await ensureFolder(), d = new Date(now()), B = 'htb' + now().toString(36);
    const name = `habit-task-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
    const body = `--${B}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder], mimeType: 'application/json' })}\r\n--${B}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${B}--`;
    const j = await jsonOf(await must(await api(`${UPLOAD}/files?uploadType=multipart&fields=id,name,createdTime`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${B}` }, body })));
    cfg.last = now(); cfg.lastName = j.name || name; delete cfg.lastError; await persist();
    try { await prune(); } catch { /* retention is best effort */ }
    return { id: j.id, name: cfg.lastName };
  }
  async function download(id) {
    const r = await must(await api(`${API}/files/${encodeURIComponent(id)}?alt=media`)); const t = await r.text();
    if (t.length > MAX_BYTES) throw new DriveError('toolarge', 'Backup file is too large'); return t;
  }

  /* --- weekly schedule: runs when the app is opened and 7+ days have passed (Android gives no reliable background timer) --- */
  async function isDue() { await load(); return !!cfg.refresh && cfg.auto !== false && now() - (cfg.last || 0) >= WEEK_MS && now() - (cfg.tried || 0) >= RETRY_MS; }
  async function autoBackup(getText, isEmpty = () => false) {
    if (!(await isDue())) return { ran: false };
    if (isEmpty()) return { ran: false, skipped: 'empty' }; // never let an empty app push good backups out of the rotation
    cfg.tried = now(); await persist();
    try { const r = await backup(getText()); return { ran: true, ok: true, name: r.name }; }
    catch (e) { cfg.lastError = e.message; await persist(); return { ran: true, ok: false, error: e.message, code: e.code }; }
  }
  async function disconnect() {
    await load(); const t = cfg.refresh;
    delete cfg.refresh; delete cfg.folderId; tok = null; await persist();
    if (t) { try { await postForm(REVOKE_URL, { token: t }); } catch { /* best effort */ } }
  }
  async function forget() { cfg = {}; tok = null; await kv.remove('drive'); }
  return { status, setCredentials, setAuto, startAuth, pollAuth, list, backup, download, isDue, autoBackup, disconnect, forget };
}
