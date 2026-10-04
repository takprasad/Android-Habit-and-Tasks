/* Durable storage adapter.
 * Native: @capacitor/preferences (SharedPreferences - not clearable by the WebView/"clear site data").
 * Web (dev, tests): localStorage.
 * Two alternating slots with sequence number + checksum, so a write interrupted by a kill can never
 * leave the app without a valid copy: load() picks the newest slot that parses and verifies. */
const cap = globalThis.Capacitor;
export const isNative = !!cap?.isNativePlatform?.();
const Prefs = isNative ? (typeof cap.registerPlugin === 'function' ? cap.registerPlugin('Preferences') : (cap.Plugins?.['Preferences'] || cap.Plugins?.['preferences'])) : null;

const backend = isNative
  ? { get: async (k) => (await Prefs.get({ key: k })).value, set: (k, v) => Prefs.set({ key: k, value: v }), remove: (k) => Prefs.remove({ key: k }) }
  : { get: async (k) => localStorage.getItem(k), set: async (k, v) => localStorage.setItem(k, v), remove: async (k) => localStorage.removeItem(k) };

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
  const a = unpack(await backend.get(KEYS.A)), b = unpack(await backend.get(KEYS.B));
  const best = [a, b].filter(Boolean).sort((x, y) => y.seq - x.seq)[0];
  if (best) { seq = best.seq; slot = best === a ? 'B' : 'A'; return best.data; }
  const legacy = await backend.get(KEYS.LEGACY);
  if (legacy) { try { return JSON.parse(legacy); } catch { /* corrupt legacy: ignore */ } }
  return null;
}

let timer = null, chain = Promise.resolve(), getState = null, onError = () => {};
export function init(getter, errHandler) { getState = getter; if (errHandler) onError = errHandler; }
async function write() {
  const json = JSON.stringify(getState()); seq++;
  const key = slot === 'A' ? KEYS.A : KEYS.B; slot = slot === 'A' ? 'B' : 'A';
  await backend.set(key, pack(seq, json));
}
/** Debounced save (120 ms) - cheap enough to call on every mutation. */
export function save() { clearTimeout(timer); timer = setTimeout(flush, 120); }
/** Write now (called on pause / hide / before unload). */
export function flush() { clearTimeout(timer); timer = null; chain = chain.then(write).catch((e) => onError(e)); return chain; }
export async function saveBackup(json) { await backend.set(KEYS.BACKUP, json); }
export async function wipe() { clearTimeout(timer); await chain; for (const k of Object.values(KEYS)) await backend.remove(k); seq = 0; slot = 'A'; }
