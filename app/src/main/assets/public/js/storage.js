/* Durable storage adapter.
 * Native: @capacitor/preferences (SharedPreferences - not clearable by the WebView/"clear site data"),
 *         mirrored into the WebView's localStorage on every save as a second copy.
 * Web (dev, tests): localStorage.
 * Two alternating slots with sequence number + checksum, so a write interrupted by a kill can never
 * leave the app without a valid copy: load() picks the newest slot that parses and verifies. */
const cap = globalThis.Capacitor;
export const isNative = !!cap?.isNativePlatform?.();
const Prefs = isNative ? (typeof cap.registerPlugin === 'function' ? cap.registerPlugin('Preferences') : (cap.Plugins?.['Preferences'] || cap.Plugins?.['preferences'])) : null;

const backend = isNative
  ? { get: async (k) => (await Prefs.get({ key: k })).value, set: (k, v) => Prefs.set({ key: k, value: v }), remove: (k) => Prefs.remove({ key: k }) }
  : { get: async (k) => localStorage.getItem(k), set: async (k, v) => localStorage.setItem(k, v), remove: async (k) => localStorage.removeItem(k) };

/* Second copy in localStorage (native only; on the web the main backend already is localStorage).
 * Best-effort: a full or unavailable localStorage never blocks a save. */
const LS = (() => { try { return globalThis.localStorage || null; } catch { return null; } })();
const mirror = isNative && LS ? {
  get: (k) => { try { return LS.getItem('ls_' + k); } catch { return null; } },
  set: (k, v) => { try { LS.setItem('ls_' + k, v); } catch { /* quota: ignore */ } },
  remove: (k) => { try { LS.removeItem('ls_' + k); } catch { /* ignore */ } },
} : null;

export const KEYS = { A: 'ht2_a', B: 'ht2_b', LEGACY: 'ht1', BACKUP: 'ht2_backup' };
export const checksum = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
const pack = (seq, json) => `${seq}|${checksum(json)}|${json}`;
function unpack(raw) {
  if (!raw) return null;
  const i = raw.indexOf('|'), j = raw.indexOf('|', i + 1); if (i < 1 || j < 0) return null;
  const json = raw.slice(j + 1);
  if (checksum(json) !== raw.slice(i + 1, j)) return null;
  try { return { seq: +raw.slice(0, i), data: JSON.parse(json) }; } catch { return null; }
}

let seq = 0, slot = 'A';
/** Returns the stored raw object (unvalidated) or null. Falls back to the legacy v1 key (web app data). */
export async function load() {
  const cands = [];
  for (const key of [KEYS.A, KEYS.B]) {
    const raw = await backend.get(key), u = unpack(raw); if (u) cands.push({ ...u, key, raw, src: 0 });
    const mraw = mirror ? mirror.get(key) : null, mu = unpack(mraw); if (mu) cands.push({ ...mu, key, raw: mraw, src: 1 });
  }
  // newest wins; on a tie the primary store (Preferences) wins over the localStorage copy
  const best = cands.sort((x, y) => y.seq - x.seq || x.src - y.src)[0];
  if (best) {
    seq = best.seq; slot = best.key === KEYS.A ? 'B' : 'A';
    if (best.src === 1) { try { await backend.set(best.key, best.raw); } catch { /* next save rewrites it */ } } // Preferences was empty or older: restore it from localStorage
    return best.data;
  }
  const legacy = await backend.get(KEYS.LEGACY);
  if (legacy) { try { return JSON.parse(legacy); } catch { /* corrupt legacy: ignore */ } }
  return null;
}

let timer = null, chain = Promise.resolve(), getState = null, onError = () => {};
export function init(getter, errHandler) { getState = getter; if (errHandler) onError = errHandler; }
async function write() {
  const json = JSON.stringify(getState()); seq++;
  const key = slot === 'A' ? KEYS.A : KEYS.B; slot = slot === 'A' ? 'B' : 'A';
  const packed = pack(seq, json);
  if (mirror) mirror.set(key, packed);
  await backend.set(key, packed);
}
/** Debounced save (120 ms) - cheap enough to call on every mutation. */
export function save() { clearTimeout(timer); timer = setTimeout(flush, 120); }
/** Write now (called on pause / hide / before unload). */
export function flush() { clearTimeout(timer); timer = null; chain = chain.then(write).catch((e) => onError(e)); return chain; }
/* Small key-value area for things that must NOT travel inside exports/backups (e.g. Google sign-in). Primary store only. */
export const kvGet = (k) => backend.get('ht_kv_' + k);
export const kvSet = (k, v) => backend.set('ht_kv_' + k, v);
export const kvRemove = (k) => backend.remove('ht_kv_' + k);
export async function saveBackup(json) { await backend.set(KEYS.BACKUP, json); }
export async function wipe() { clearTimeout(timer); await chain; for (const k of Object.values(KEYS)) { await backend.remove(k); if (mirror) mirror.remove(k); } seq = 0; slot = 'A'; }
