/* Thin wrappers around Capacitor plugins. Every call degrades gracefully on the plain web so the same
 * code runs in a desktop browser (dev + Playwright tests). Plugins are reached through registerPlugin,
 * so the web layer needs no bundler. */
const cap = globalThis.Capacitor;
export const isNative = !!cap?.isNativePlatform?.();
const plug = (n) => {
  if (!isNative) return null;
  if (typeof cap.registerPlugin === 'function') return cap.registerPlugin(n);
  const name = n.charAt(0).toLowerCase() + n.slice(1);
  return cap.Plugins?.[n] || cap.Plugins?.[name] || null;
};
const App = plug('App'), Browser = plug('Browser'), StatusBar = plug('StatusBar'), SystemBars = plug('SystemBars'), Splash = plug('SplashScreen');
const LN = plug('LocalNotifications'), Share = plug('Share'), FS = plug('Filesystem');
const safe = async (f) => { try { return await f(); } catch (e) { console.warn('[native]', e?.message || e); return undefined; } };

export async function onBack(handler) { if (App) await App.addListener('backButton', () => { if (!handler()) App.exitApp(); }); }
export async function onAppState(cb) { if (App) { await App.addListener('appStateChange', (s) => cb(s.isActive)); await App.addListener('pause', () => cb(false)); await App.addListener('resume', () => cb(true)); } }
export async function hideSplash() { if (Splash) await safe(() => Splash.hide()); }
/** dark === true -> light status/gesture-bar icons. */
export async function setBars(dark) {
  const style = dark ? 'DARK' : 'LIGHT';
  if (SystemBars) await safe(() => SystemBars.setStyle({ style }));
  if (StatusBar) await safe(() => StatusBar.setStyle({ style }));
}
export async function openLink(url) {
  if (Browser) return safe(() => Browser.open({ url }));
  window.open(url, '_blank', 'noopener,noreferrer');
}
/** Export a text file: share sheet on Android, download in a browser. */
export async function exportFile(name, mime, text) {
  if (FS && Share) {
    const r = await FS.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
    await Share.share({ title: name, dialogTitle: 'Export data', url: r.uri });
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---- notifications ---- */
const CH = 'reminders';
export async function notifPermission(ask) {
  if (!LN) return 'granted';
  const p = await safe(() => (ask ? LN.requestPermissions() : LN.checkPermissions()));
  return p?.display || 'denied';
}
let q = Promise.resolve();
/** Replace everything pending with `plan` (idempotent). Serialised so overlapping syncs cannot interleave. */
export function applyPlan(plan, enabled) {
  if (!LN) return Promise.resolve();
  q = q.then(() => safe(async () => {
    const pend = await LN.getPending(); if (pend.notifications.length) await LN.cancel({ notifications: pend.notifications.map((n) => ({ id: n.id })) });
    if (!enabled || !plan.length || (await notifPermission(false)) !== 'granted') return;
    await LN.createChannel({ id: CH, name: 'Reminders', description: 'Habit and task reminders', importance: 3 });
    await LN.schedule({ notifications: plan.map((n) => ({ id: n.id, title: n.title, body: n.body, channelId: CH, smallIcon: 'ic_stat_habit', iconColor: '#0F6B5C', schedule: n.repeat ? { on: n.repeat, allowWhileIdle: true } : { at: new Date(n.at), allowWhileIdle: true } })) });
  }));
  return q;
}
/** Immediate notification (reward unlocked). */
export function notifyNow(id, title, body) {
  if (!LN) return;
  q = q.then(() => safe(async () => {
    if ((await notifPermission(false)) !== 'granted') return;
    await LN.createChannel({ id: CH, name: 'Reminders', description: 'Habit and task reminders', importance: 3 });
    await LN.schedule({ notifications: [{ id, title, body, channelId: CH, smallIcon: 'ic_stat_habit', iconColor: '#0F6B5C', schedule: { at: new Date(Date.now() + 700) } }] });
  }));
}
