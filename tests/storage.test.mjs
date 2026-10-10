import assert from 'node:assert/strict';
const SRC = '../app/src/main/assets/public/js/storage.js';
const mem = () => ({ _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { if (this.full) throw new Error('QuotaExceededError'); this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } });
const prefs = new Map();
globalThis.localStorage = mem();
globalThis.Capacitor = { isNativePlatform: () => true, registerPlugin: () => ({ get: async ({ key }) => ({ value: prefs.has(key) ? prefs.get(key) : null }), set: async ({ key, value }) => { prefs.set(key, value); }, remove: async ({ key }) => { prefs.delete(key); } }) };
let n = 0, gen = 0; const fresh = async () => import(SRC + '?g=' + (++gen)); // new import = app restart
const t = async (name, f) => { await f(); n++; console.log('ok', name); };
const saveState = async (s, state) => { s.init(() => state); await s.flush(); };

await t('first run: nothing stored', async () => { const s = await fresh(); assert.equal(await s.load(), null); });
await t('save writes BOTH Preferences and localStorage', async () => {
  const s = await fresh(); await s.load(); await saveState(s, { v: 1, coins: 5 });
  assert.ok(prefs.has('ht2_a') && localStorage.getItem('ls_ht2_a'), 'both copies written'); assert.equal(prefs.get('ht2_a'), localStorage.getItem('ls_ht2_a'));
  await saveState(s, { v: 1, coins: 6 }); assert.ok(prefs.has('ht2_b') && localStorage.getItem('ls_ht2_b'), 'second slot mirrored too');
});
await t('normal restart loads the newest', async () => { const s = await fresh(); assert.equal((await s.load()).coins, 6); });
await t('Preferences wiped -> recovered from localStorage and Preferences restored', async () => {
  prefs.clear(); const s = await fresh(); const d = await s.load(); assert.equal(d.coins, 6); assert.ok(prefs.has('ht2_b'), 'restored into Preferences');
  await saveState(s, { v: 1, coins: 7 }); const s2 = await fresh(); assert.equal((await s2.load()).coins, 7, 'next save continues the sequence');
});
await t('localStorage cleared -> Preferences still loads', async () => {
  localStorage._m.clear(); const s = await fresh(); assert.equal((await s.load()).coins, 7); await saveState(s, { v: 1, coins: 8 }); assert.ok(localStorage.getItem('ls_ht2_a') || localStorage.getItem('ls_ht2_b'), 'mirror refilled');
});
await t('newer localStorage copy beats older Preferences', async () => {
  const s = await fresh(); await s.load(); await saveState(s, { v: 1, coins: 9 });
  const keyOf = (m) => ['ht2_a', 'ht2_b'].map((k) => [k, m(k)]).filter(([, v]) => v && v.includes('"coins":9'))[0][0];
  const k = keyOf((k) => localStorage.getItem('ls_' + k)); const rawNew = localStorage.getItem('ls_' + k);
  const other = k === 'ht2_a' ? 'ht2_b' : 'ht2_a'; // make Preferences hold only an older state
  prefs.set(k, prefs.get(other)); const s2 = await fresh(); assert.equal((await s2.load()).coins, 9); assert.equal(prefs.get(k), rawNew, 'Preferences healed from the newer mirror');
});
await t('corrupt localStorage copy is ignored', async () => {
  for (const k of ['ls_ht2_a', 'ls_ht2_b']) localStorage.setItem(k, '99|deadbeef|{"coins":999}'); const s = await fresh(); assert.equal((await s.load()).coins, 9);
});
await t('localStorage quota error never blocks a save', async () => {
  const s = await fresh(); await s.load(); localStorage.full = true; await saveState(s, { v: 1, coins: 10 }); localStorage.full = false;
  const s2 = await fresh(); assert.equal((await s2.load()).coins, 10, 'saved in Preferences despite quota error');
});
await t('wipe clears both stores', async () => {
  const s = await fresh(); await s.load(); s.init(() => ({})); await s.wipe();
  assert.equal([...prefs.keys()].filter((k) => k.startsWith('ht2_')).length, 0); assert.equal([...localStorage._m.keys()].filter((k) => k.startsWith('ls_')).length, 0);
  assert.equal(await (await fresh()).load(), null);
});
await t('web mode (not native) uses localStorage only, no double write', async () => {
  globalThis.Capacitor = undefined; localStorage._m.clear(); const s = await fresh(); await s.load(); await saveState(s, { v: 1, coins: 1 });
  assert.ok(localStorage.getItem('ht2_a')); assert.equal([...localStorage._m.keys()].filter((k) => k.startsWith('ls_')).length, 0); assert.equal((await (await fresh()).load()).coins, 1);
});
console.log(n, 'storage tests passed');
