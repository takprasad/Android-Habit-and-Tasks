/* Habit & Task Tracker - pure logic (no DOM, no Capacitor).
 * Every function takes the state `S` explicitly and reads time only through `clock`,
 * so the whole engine is unit-testable with a fake clock and any TZ. */

export const clock = { now: () => new Date() };
export const setNow = (fn) => { clock.now = fn; };
export const hooks = { celebrate() {}, reward() {} };

export const uid = () => Math.random().toString(36).slice(2, 12);
const pad = (n) => String(n).padStart(2, '0');

/* ---------- dates (all calendar math is local-date based and DST-safe) ---------- */
export function D(d) { d = d || clock.now(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
export const today = () => D();
/* Parse YYYY-MM-DD to a local Date at 12:00 (noon avoids DST-gap midnights). */
export function P(s) { const [y, m, d] = s.split('-').map(Number); const x = new Date(2000, 0, 1, 12); x.setFullYear(y, m - 1, d); return x; }
export function add(s, n) { const d = P(s); d.setDate(d.getDate() + n); return D(d); }
export function diffDays(a, b) { const [ya, ma, da] = a.split('-').map(Number), [yb, mb, db] = b.split('-').map(Number); return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 864e5); }
/** Monday = 0 ... Sunday = 6 (the index used by Habit.days). */
export const dow = (s) => (P(s).getDay() + 6) % 7;
/** Start of week containing s; ws is a getDay() index (0=Sun, 1=Mon, ... 6=Sat). */
export const wk = (s, ws = 1) => add(s, -((P(s).getDay() - ws + 7) % 7));
export const monthStart = (s) => s.slice(0, 8) + '01';
export const monthEnd = (s) => { const [y, m] = s.split('-').map(Number); return s.slice(0, 8) + pad(new Date(y, m, 0).getDate()); };
export const nowHM = () => { const d = clock.now(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
export const tzKey = () => { let z = ''; try { z = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* ignore */ } return z + '|' + clock.now().getTimezoneOffset(); };

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const PR = { High: 0, Medium: 1, Low: 2 };
export const TASK_COINS = { High: 5, Medium: 3, Low: 2 };
export const hm = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${m}m` : `${m}m`; };
export const clockStr = (s) => { s = Math.floor(s); return [Math.floor(s / 3600), Math.floor(s % 3600 / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':'); };
export const safeUrl = (u) => /^https?:\/\//i.test(u || '');
export const CLOSED = ['Completed', 'Cancelled', 'Archived'];
export const isOpen = (k) => !CLOSED.includes(k.status);

/* ---------- state ---------- */
export const defaultSettings = () => ({
  weekStart: 1,
  notif: { on: false, daily: true, dailyTime: '20:00', risk: true, due: true, timer: true, reward: true },
});
export const newState = () => ({ v: 2, coins: 0, habits: [], checkins: [], tasks: [], sessions: [], rewards: [], timer: null, theme: 'system', audit: [], settings: defaultSettings() });
export const log = (S, type, id, p) => { S.audit.push({ type, id, p, at: clock.now().getTime() }); };

/* ---------- habit engine ---------- */
export const req = (h) => h.type === 'daily' ? 1 : h.type === 'weekly' ? h.n : h.type === 'days' ? h.days.length : h.type === 'every' ? 1 : h.n;
export const isScheduled = (h, t) => h.type !== 'days' || h.days.includes(dow(t));

/* Per-habit set of check-in days, cached on (array identity, length). Check-ins are only ever
 * removed by replacing the array (filter), so identity+length is a safe cache key. */
const idxCache = new WeakMap();
export function daysIndex(S) {
  const c = idxCache.get(S);
  if (c && c.arr === S.checkins && c.len === S.checkins.length) return c.map;
  const map = new Map();
  for (const x of S.checkins) { let s = map.get(x.h); if (!s) map.set(x.h, s = new Set()); s.add(x.d); }
  idxCache.set(S, { arr: S.checkins, len: S.checkins.length, map });
  return map;
}
const EMPTY = new Set();
export const hDays = (S, h) => daysIndex(S).get(h.id) || EMPTY;

export function period(S, h, d) {
  switch (h.type) {
    case 'daily': return [d, d];
    case 'every': { const n = h.every, k = Math.max(0, Math.floor(diffDays(h.start, d) / n)); const a = add(h.start, k * n); return [a, add(a, n - 1)]; }
    case 'monthly': return [monthStart(d), monthEnd(d)];
    default: { const a = wk(d, S.settings.weekStart); return [a, add(a, 6)]; }
  }
}
export function done(S, h, [a, b], set = hDays(S, h)) {
  let n = 0;
  for (let d = a; d <= b; d = add(d, 1)) if (set.has(d) && (h.type !== 'days' || h.days.includes(dow(d)))) n++;
  return n;
}
export function status(S, h, t = today()) {
  if (h.paused) return 'Paused';
  const p = period(S, h, t), n = done(S, h, p), r = req(h);
  if (h.type === 'daily') return n ? 'On track' : 'Due today';
  if (n >= r) return 'On track';
  let left = 0;
  if (h.type === 'days') { for (let d = t; d <= p[1]; d = add(d, 1)) if (h.days.includes(dow(d))) left++; } else left = diffDays(t, p[1]) + 1;
  return r - n >= left ? 'At risk' : 'On track';
}

function unlock(S, h, src) {
  const r = { id: uid(), name: h.ms.reward || 'Milestone reached', url: h.ms.url, src, status: 'unlocked', at: clock.now().getTime() };
  S.rewards.push(r); log(S, 'reward_unlocked', h.id, { r: h.ms.reward }); hooks.reward(r);
}
export function checkMs(S, h) {
  if (h.prog >= h.ms.target) {
    h.attempts.push({ s: h.attemptStart, e: today(), state: 'Completed', prog: h.prog });
    h.completed++; unlock(S, h, h.name); h.prog = 0; h.attemptStart = today();
    log(S, 'milestone_completed', h.id); hooks.celebrate('🎉 Milestone reached! Reward unlocked.');
  }
}
export function bump(S, h, d) { h.prog = Math.max(0, h.prog + d); if (d > 0) h.best = Math.max(h.best, h.prog); checkMs(S, h); }

export const MAX_BACKDATE_DAYS = 7;
/** Can a check-in be recorded for date d? Returns '' if ok, else a reason. */
export function checkinBlocked(S, h, d = today()) {
  const t = today();
  if (h.archived) return 'archived';
  if (h.paused) return 'paused';
  if (d > t) return 'future';
  if (d < add(t, -MAX_BACKDATE_DAYS)) return 'too-old';
  if (d < h.start) return 'before-start';
  if (!isScheduled(h, d)) return 'not-scheduled';
  if (hDays(S, h).has(d) && !h.multi) return 'duplicate';
  return '';
}
/** Record a check-in (today by default; up to 7 days back with an audit event). Returns id or null. */
export function checkin(S, h, d = today()) {
  if (checkinBlocked(S, h, d)) return null;
  const set = hDays(S, h), had = set.has(d), t = today(), id = uid();
  S.checkins.push({ id, h: h.id, d, at: clock.now().getTime(), tz: tzKey().split('|')[0], ...(d !== t ? { bd: 1 } : {}) });
  if (d === t) log(S, 'checkin', h.id); else log(S, 'checkin_backdated', h.id, { date: d });
  if (h.ms.kind === 'count' || (h.ms.kind === 'streak' && h.type === 'daily' && !had)) bump(S, h, 1);
  return id;
}
export function undoCheckin(S, h, id) {
  const before = S.checkins.length;
  S.checkins = S.checkins.filter((c) => c.id !== id);
  if (S.checkins.length === before) return false;
  if (h.prog > 0 && (h.ms.kind === 'count' || h.type === 'daily')) h.prog--;
  log(S, 'checkin_undone', h.id);
  return true;
}
/** Undo the latest check-in recorded for today (tap on a done check button). */
export function undoToday(S, h) {
  const c = S.checkins.filter((x) => x.h === h.id && x.d === today()).pop();
  return c ? undoCheckin(S, h, c.id) : false;
}

export function reset(S, h, why) {
  h.attempts.push({ s: h.attemptStart, e: today(), state: 'Reset', prog: h.prog });
  h.resets++; h.prog = 0; h.attemptStart = today(); h.ask = null; log(S, 'milestone_reset', h.id, { why });
}
export function keepProgress(S, h) { h.ask = null; log(S, 'milestone_kept', h.id); }

/** Evaluate every finished period of every active habit. Idempotent; safe to call any time. */
export function evaluate(S) {
  const t = today(); let changed = false;
  for (const k of S.tasks) {
    if (isOpen(k) && k.due && k.due < t) {
      const overdueDays = diffDays(k.due, t);
      const prev = k.penalisedDays || 0;
      if (overdueDays > prev) {
        const diff = overdueDays - prev;
        S.coins = Math.max(0, (S.coins || 0) - diff);
        k.penalisedDays = overdueDays;
        log(S, 'coin_penalty', k.id, { days: diff, coins: S.coins });
        changed = true;
      }
    }
  }
  for (const h of S.habits) {
    if (h.archived) continue;
    if (h.paused) { // paused habits are never judged; skip to the next period boundary on resume
      continue;
    }
    let p = h.evalFrom, guard = 0;
    const set = hDays(S, h);
    while (period(S, h, p)[1] < t) {
      if (++guard > 1000) { p = period(S, h, t)[0]; log(S, 'evaluation_skipped', h.id, { to: p }); changed = true; break; }
      const [a, b] = period(S, h, p);
      if (b >= h.start) {
        const n = done(S, h, [a, b], set), r = req(h), ok = n >= r;
        h.evals.push({ a, b, r, n, ok }); log(S, ok ? 'period_met' : 'period_missed', h.id, { a, n, r });
        if (ok) { if (h.ms.kind === 'streak' && h.type !== 'daily') bump(S, h, 1); } else if (h.ms.policy === 'reset') reset(S, h, a); else if (h.ms.policy === 'ask') h.ask = a;
        changed = true;
      }
      p = add(b, 1);
    }
    if (h.evalFrom !== p) { h.evalFrom = p; changed = true; }
  }
  return changed;
}
export function pauseHabit(S, h) { if (h.paused) return; h.paused = true; h.ask = null; log(S, 'habit_paused', h.id); }
export function resumeHabit(S, h) {
  if (!h.paused) return; h.paused = false;
  h.evalFrom = add(period(S, h, today())[1], 1); // the partial period in progress is not judged
  log(S, 'habit_resumed', h.id);
}
export function unarchiveHabit(S, h) { h.archived = false; h.evalFrom = period(S, h, today())[0]; log(S, 'habit_restored', h.id); }

/* ---------- task engine ---------- */
export const overdue = (k) => !!k.due && isOpen(k) && (k.due < today() || (k.due === today() && !!k.time && k.time < nowHM()));
export const elapsed = (S, k) => S.timer && S.timer.id === k.id ? Math.max(0, S.timer.acc + (S.timer.run ? (clock.now().getTime() - S.timer.at) / 1000 : 0)) : 0;
export const worked = (S, k) => S.sessions.filter((s) => s.t === k.id).reduce((a, s) => a + s.dur, 0);
export const everySec = (k) => k.ms.every * 3600;
/** Seconds shown toward the *next* reward. In keep-adding mode mp is cumulative. */
export const toward = (k) => k.ms.after === 'add' ? k.mp - everySec(k) * k.fired : k.mp;

function unlockT(S, k, msg) {
  const r = { id: uid(), name: k.ms.reward || 'Work milestone', url: k.ms.url, src: k.title, status: 'unlocked', at: clock.now().getTime() };
  S.rewards.push(r); log(S, 'reward_unlocked', k.id, { r: k.ms.reward }); hooks.reward(r); hooks.celebrate(msg || '🎉 Work milestone reached!');
}
export function addSession(S, k, dur, type, note, start) {
  const now = clock.now().getTime();
  S.sessions.push({ id: uid(), t: k.id, start: start || now - dur * 1000, dur, type, note });
  log(S, type === 'timer' ? 'timer_stopped' : 'session_added', k.id, { dur });
  if (k.status === 'Not Started') k.status = 'In Progress';
  k.last = now;
  if (k.ms.mode === 'worklog') {
    const ev = everySec(k); k.mp += dur;
    if (k.ms.after === 'add') { while (k.mp >= ev * (k.fired + 1)) { k.fired++; unlockT(S, k); } }
    else if (k.ms.after === 'carry') { while (k.mp >= ev) { k.mp -= ev; unlockT(S, k); } }
    else if (k.mp >= ev) { k.mp = 0; unlockT(S, k); } // reset to 0: exactly one reward, remainder discarded
  }
}
export function complete(S, k) {
  k.status = 'Completed'; k.doneAt = clock.now().getTime(); log(S, 'task_completed', k.id);
  const earned = (TASK_COINS[k.pri] || 3) + (k.bonusCoins || 0);
  S.coins = (S.coins || 0) + earned;
  log(S, 'coins_earned', k.id, { earned, coins: S.coins });
  if (S.timer && S.timer.id === k.id) stopTimer(S);
  if (k.ms.mode === 'once' && k.ms.reward && !k.once) { k.once = 1; unlockT(S, k, `🎉 Milestone reached! Earned 🪙 ${earned} Supercoins!`); }
  else { hooks.celebrate(`🎉 Task completed! Earned 🪙 ${earned} Supercoins.`); }
}
export function claimReward(S, r) {
  const cost = r.cost || 0;
  if ((S.coins || 0) < cost) return false;
  S.coins = (S.coins || 0) - cost;
  r.status = 'claimed';
  r.claimedAt = clock.now().getTime();
  log(S, 'reward_claimed', r.id, { cost, coins: S.coins });
  return true;
}
export function reopen(S, k) { k.status = 'In Progress'; log(S, 'task_reopened', k.id); }
export function startTimer(S, k) {
  if (S.timer && S.timer.id !== k.id) stopTimer(S);
  if (S.timer && S.timer.id === k.id) return;
  S.timer = { id: k.id, run: true, at: clock.now().getTime(), acc: 0 };
  if (k.status === 'Not Started') k.status = 'In Progress';
  log(S, 'timer_started', k.id);
}
export function pauseTimer(S) { const k = S.tasks.find((x) => x.id === S.timer?.id); if (!k || !S.timer.run) return; S.timer.acc = elapsed(S, k); S.timer.run = false; log(S, 'timer_paused', k.id); }
export function resumeTimer(S) { if (!S.timer || S.timer.run) return; S.timer.at = clock.now().getTime(); S.timer.run = true; log(S, 'timer_resumed', S.timer.id); }
/** Stop and save. Idempotent: a second call finds no timer and creates no session. Returns the session length or 0. */
export function stopTimer(S) {
  if (!S.timer) return 0;
  const k = S.tasks.find((x) => x.id === S.timer.id), d = k ? elapsed(S, k) : 0;
  S.timer = null;
  if (k && d >= 1) { addSession(S, k, d, 'timer'); return d; }
  return 0;
}
export function deleteTask(S, k) {
  if (S.timer?.id === k.id) S.timer = null;
  S.tasks = S.tasks.filter((x) => x !== k); S.sessions = S.sessions.filter((s) => s.t !== k.id);
}

/** Today dashboard selection. */
export function dashboard(S) {
  const t = today(), run = (k) => S.timer && S.timer.id === k.id;
  const habits = S.habits.filter((h) => !h.archived && !h.paused && isScheduled(h, t));
  const open = S.tasks.filter(isOpen);
  const dueL = open.filter((k) => (k.due && k.due <= t) || (run(k) && k.due)).sort((a, b) =>
    a.due < b.due ? -1 : a.due > b.due ? 1 : (a.time || '99') < (b.time || '99') ? -1 : (a.time || '99') > (b.time || '99') ? 1 : PR[a.pri] - PR[b.pri]);
  const any = open.filter((k) => !k.due && (run(k) || k.status === 'In Progress' || k.start <= t)).sort((a, b) =>
    (run(b) ? 1 : 0) - (run(a) ? 1 : 0) || (b.status === 'In Progress') - (a.status === 'In Progress') || PR[a.pri] - PR[b.pri] || (b.last || 0) - (a.last || 0));
  const anyShow = any.filter(run).concat(any.filter((k) => !run(k)).slice(0, 3));
  return {
    habits, doneHabits: habits.filter((h) => hDays(S, h).has(t)).length, dueL, anyShow,
    doneTasks: S.tasks.filter((k) => k.status === 'Completed' && k.doneAt && D(new Date(k.doneAt)) === t).length,
    asks: S.habits.filter((h) => h.ask && !h.archived),
  };
}
/** Task list screen ordering. */
export function filterTasks(S, q, fil) {
  let l = S.tasks.filter((k) => k.title.toLowerCase().includes(q.toLowerCase()));
  l = l.filter((k) => fil === 'open' ? isOpen(k) : fil === 'done' ? k.status === 'Completed' : fil === 'over' ? overdue(k) : true);
  return l.sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : (a.due || '9') > (b.due || '9') ? 1 : PR[a.pri] - PR[b.pri]);
}

/* ---------- audit history ---------- */
const AUDIT = {
  checkin: () => 'Checked in', checkin_backdated: (p) => `Checked in for ${p?.date} (backdated)`, checkin_undone: () => 'Check-in undone',
  period_met: (p) => `Period from ${p?.a} met (${p?.n}/${p?.r})`, period_missed: (p) => `Period from ${p?.a} hindered (${p?.n}/${p?.r})`,
  milestone_completed: () => 'Milestone completed', milestone_reset: () => 'Milestone progress reset', milestone_kept: () => 'Kept milestone progress',
  reward_unlocked: (p) => 'Reward unlocked' + (p?.r ? `: ${p.r}` : ''), reward_claimed: () => 'Reward claimed',
  habit_created: () => 'Habit created', habit_edited: (p) => 'Habit edited' + (p?.fields?.length ? ` (${p.fields.join(', ')})` : ''),
  habit_paused: () => 'Habit paused', habit_resumed: () => 'Habit resumed', habit_restored: () => 'Habit restored', habit_archived: () => 'Habit archived', evaluation_skipped: () => 'Long gap skipped',
  task_created: () => 'Task created', task_edited: (p) => 'Task edited' + (p?.fields?.length ? ` (${p.fields.join(', ')})` : ''),
  task_completed: () => 'Task completed', task_reopened: () => 'Task reopened',
  timer_started: () => 'Timer started', timer_paused: () => 'Timer paused', timer_resumed: () => 'Timer resumed',
  timer_stopped: (p) => `Timer stopped, ${hm(p?.dur || 0)} logged`, session_added: (p) => `Logged ${hm(p?.dur || 0)} manually`,
  coin_penalty: (p) => `Penalty: -${p?.days || 1} coin(s) for overdue delay`,
};
export const describeAudit = (e) => (AUDIT[e.type] ? AUDIT[e.type](e.p) : e.type.replace(/_/g, ' '));
export const auditFor = (S, id) => S.audit.filter((e) => e.id === id).sort((a, b) => b.at - a.at);

/* ---------- import validation / migration ---------- */
const ID = /^[A-Za-z0-9_-]{1,64}$/, DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^\d{2}:\d{2}$/;
const bad = (m) => { throw new Error('Invalid data: ' + m); };
const str = (v, m, max = 200) => typeof v === 'string' && v.length <= max ? v : bad(m);
const optStr = (v, m, max = 2000) => v == null ? '' : str(v, m, max);
const num = (v, m, lo = -Infinity, hi = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : bad(m);
const opt = (v, d, f) => v == null ? d : f(v);
const oneOf = (v, list, m) => list.includes(v) ? v : bad(m);
const arr = (v, m) => Array.isArray(v) ? v : bad(m);
const id = (v, m) => typeof v === 'string' && ID.test(v) ? v : bad(m + ' id');
const date = (v, m) => typeof v === 'string' && DATE.test(v) ? v : bad(m);

/** Validate + normalise any exported / legacy state. Throws on invalid input; never partially applies. */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('not an object');
  if (!Array.isArray(raw.habits) || !Array.isArray(raw.tasks)) bad('missing habits/tasks');
  const S = newState();
  S.coins = opt(raw.coins, 0, (v) => num(v, 'coins', 0));
  S.theme = oneOf(raw.theme ?? 'system', ['system', 'light', 'dark'], 'theme');
  const st = raw.settings || {}, ds = defaultSettings();
  S.settings = { weekStart: opt(st.weekStart, 1, (v) => num(v, 'weekStart', 0, 6)), notif: { ...ds.notif } };
  for (const k of Object.keys(ds.notif)) {
    if (st.notif && k in st.notif) {
      const v = st.notif[k];
      S.settings.notif[k] = typeof ds.notif[k] === 'boolean' ? !!v : (typeof v === 'string' && TIME.test(v) ? v : ds.notif[k]);
    }
  }
  const hid = new Set(), tid = new Set();
  S.habits = raw.habits.map((h) => {
    if (!h || typeof h !== 'object') bad('habit');
    const type = oneOf(h.type, ['daily', 'weekly', 'days', 'every', 'monthly'], 'habit type'), ms = h.ms || {};
    const start = date(h.start, 'habit start'), hh = {
      id: id(h.id, 'habit'), name: str(h.name, 'habit name', 200), icon: optStr(h.icon, 'icon', 16), cat: optStr(h.cat, 'cat', 40), type,
      n: opt(h.n, 4, (v) => num(v, 'n', 1, 31)), every: opt(h.every, 2, (v) => num(v, 'every', 1, 365)),
      days: opt(h.days, [], (v) => arr(v, 'days').map((x) => num(x, 'day', 0, 6))), start, multi: !!h.multi,
      ms: { kind: oneOf(ms.kind ?? 'count', ['count', 'streak'], 'ms.kind'), target: opt(ms.target, 1, (v) => num(v, 'target', 1, 1e6)), policy: oneOf(ms.policy ?? 'reset', ['reset', 'pause', 'ask'], 'policy'), reward: optStr(ms.reward, 'reward', 200), url: optStr(ms.url, 'url') },
      prog: opt(h.prog, 0, (v) => num(v, 'prog', 0)), best: opt(h.best, 0, (v) => num(v, 'best', 0)), completed: opt(h.completed, 0, (v) => num(v, 'completed', 0)), resets: opt(h.resets, 0, (v) => num(v, 'resets', 0)),
      attempts: opt(h.attempts, [], (v) => arr(v, 'attempts').map((a) => ({ s: date(a.s, 'attempt'), e: date(a.e, 'attempt'), state: oneOf(a.state, ['Completed', 'Reset'], 'attempt state'), prog: num(a.prog, 'attempt prog') }))),
      evals: opt(h.evals, [], (v) => arr(v, 'evals').map((e) => ({ a: date(e.a, 'eval'), b: date(e.b, 'eval'), r: num(e.r, 'eval r'), n: num(e.n, 'eval n'), ok: !!e.ok }))),
      attemptStart: opt(h.attemptStart, start, (v) => date(v, 'attemptStart')), evalFrom: opt(h.evalFrom, start, (v) => date(v, 'evalFrom')),
      archived: !!h.archived, paused: !!h.paused, ask: h.ask == null ? null : date(h.ask, 'ask'),
    };
    if (type === 'days' && !hh.days.length) bad('days habit without days');
    if (hid.has(hh.id)) bad('duplicate habit id'); hid.add(hh.id); return hh;
  });
  S.tasks = raw.tasks.map((k) => {
    if (!k || typeof k !== 'object') bad('task');
    const ms = k.ms || {}, kk = {
      id: id(k.id, 'task'), title: str(k.title, 'task title', 500), pri: oneOf(k.pri ?? 'Medium', ['High', 'Medium', 'Low'], 'priority'), cat: optStr(k.cat, 'cat', 40) || 'Personal',
      due: k.due == null ? null : date(k.due, 'due'), time: k.time == null ? null : (TIME.test(k.time) ? k.time : bad('time')),
      status: oneOf(k.status ?? 'Not Started', ['Not Started', 'In Progress', 'Completed', 'Cancelled', 'Archived'], 'status'),
      start: opt(k.start, D(), (v) => date(v, 'start')), mp: opt(k.mp, 0, (v) => num(v, 'mp', 0)), fired: opt(k.fired, 0, (v) => num(v, 'fired', 0)), bonusCoins: opt(k.bonusCoins, 0, (v) => num(v, 'bonusCoins', 0)), penalisedDays: opt(k.penalisedDays, 0, (v) => num(v, 'penalisedDays', 0)),
      ms: { mode: oneOf(ms.mode ?? 'once', ['once', 'worklog'], 'ms.mode'), every: opt(ms.every, 5, (v) => num(v, 'every', 0.25, 1e4)), after: oneOf(ms.after ?? 'reset', ['reset', 'carry', 'add'], 'ms.after'), reward: optStr(ms.reward, 'reward', 200), url: optStr(ms.url, 'url') },
    };
    if (k.last != null) kk.last = num(k.last, 'last'); if (k.doneAt != null) kk.doneAt = num(k.doneAt, 'doneAt'); if (k.once) kk.once = 1;
    if (tid.has(kk.id)) bad('duplicate task id'); tid.add(kk.id); return kk;
  });
  S.checkins = opt(raw.checkins, [], (v) => arr(v, 'checkins').map((c) => ({ id: id(c.id, 'checkin'), h: id(c.h, 'checkin habit'), d: date(c.d, 'checkin date'), at: num(c.at, 'checkin at'), tz: optStr(c.tz, 'tz', 80), ...(c.bd ? { bd: 1 } : {}) })));
  S.sessions = opt(raw.sessions, [], (v) => arr(v, 'sessions').map((s) => ({ id: id(s.id, 'session'), t: id(s.t, 'session task'), start: num(s.start, 'start'), dur: num(s.dur, 'dur', 0), type: oneOf(s.type, ['timer', 'manual'], 'session type'), note: optStr(s.note, 'note', 1000) })));
  S.rewards = opt(raw.rewards, [], (v) => arr(v, 'rewards').map((r) => ({ id: id(r.id, 'reward'), name: str(r.name, 'reward name', 200), url: optStr(r.url, 'url'), src: optStr(r.src, 'src', 500), cost: opt(r.cost, 10, (x) => num(x, 'cost', 0)), status: oneOf(r.status, ['unlocked', 'claimed'], 'reward status'), at: num(r.at, 'at'), ...(r.claimedAt != null ? { claimedAt: num(r.claimedAt, 'claimedAt') } : {}) })));
  S.audit = opt(raw.audit, [], (v) => arr(v, 'audit').map((e) => ({ type: str(e.type, 'audit type', 64), id: typeof e.id === 'string' ? e.id : '', p: e.p && typeof e.p === 'object' ? e.p : undefined, at: num(e.at, 'audit at') })));
  const t = raw.timer;
  S.timer = t && tid.has(t.id) ? { id: t.id, run: !!t.run, at: num(t.at, 'timer at'), acc: num(t.acc, 'timer acc', 0) } : null;
  return S;
}
export function parseImport(text) { let raw; try { raw = JSON.parse(text); } catch { bad('not valid JSON'); } return migrate(raw); }

/* ---------- CSV export ---------- */
const FORMULA = /^[=+\-@\t\r]/;
const cell = (v) => { if (v == null) return ''; if (typeof v === 'number') return String(v); let s = String(v); if (FORMULA.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export const csvRow = (a) => a.map(cell).join(',');
export function toCsv(S) {
  const hn = new Map(S.habits.map((h) => [h.id, h.name])), tn = new Map(S.tasks.map((k) => [k.id, k.title])), iso = (ms) => new Date(ms).toISOString();
  const rows = [['record', 'id', 'name', 'date', 'category', 'status', 'value', 'detail']];
  for (const h of S.habits) rows.push(['habit', h.id, h.name, h.start, h.cat, h.archived ? 'Archived' : h.paused ? 'Paused' : 'Active', h.prog, `${sched(h)}; milestone ${h.ms.kind} ${h.ms.target}; ${h.ms.policy}; reward ${h.ms.reward}`]);
  for (const c of S.checkins) rows.push(['checkin', c.id, hn.get(c.h) ?? c.h, c.d, '', c.bd ? 'Backdated' : '', 1, c.tz]);
  for (const k of S.tasks) rows.push(['task', k.id, k.title, k.due ? k.due + (k.time ? ' ' + k.time : '') : '', k.cat, k.status, worked(S, k), `${k.pri}; seconds worked`]);
  for (const s of S.sessions) rows.push(['session', s.id, tn.get(s.t) ?? s.t, iso(s.start), '', s.type, s.dur, s.note]);
  for (const r of S.rewards) rows.push(['reward', r.id, r.name, iso(r.at), '', r.status, '', r.src]);
  for (const e of S.audit) rows.push(['audit', e.id, hn.get(e.id) ?? tn.get(e.id) ?? '', iso(e.at), '', e.type, '', describeAudit(e)]);
  return '\ufeff' + rows.map(csvRow).join('\r\n') + '\r\n';
}
export const sched = (h) => h.type === 'daily' ? 'Daily' : h.type === 'weekly' ? `${h.n} days / week` : h.type === 'every' ? `Every ${h.every} days` : h.type === 'monthly' ? `${h.n} / month` : h.days.map((i) => WD[i]).join(', ');

/* ---------- notification planner (pure; the plugin layer only applies the plan) ---------- */
export const NOTIF = { DAILY: 1001, TIMER: 1003, RISK: 2000, DUE: 100000 };
export const TIMER_LONG_MS = 3 * 3600 * 1000, RISK_HOUR = 18, DUE_LEAD_MIN = 60, DUE_DEFAULT_HOUR = 9;
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 1e6; };
const at = (d, hh, mm = 0) => { const x = P(d); x.setHours(hh, mm, 0, 0); return x.getTime(); };
export function planNotifications(S) {
  const n = S.settings.notif, plan = [], now = clock.now().getTime(), t = today();
  if (!n.on) return plan;
  if (n.daily) { const [hh, mm] = n.dailyTime.split(':').map(Number); plan.push({ id: NOTIF.DAILY, kind: 'daily', title: 'Habit & Task Tracker', body: "Time to check in on today's habits.", repeat: { hour: hh, minute: mm } }); }
  if (n.risk) {
    for (let i = 0; i < 3; i++) {
      const d = add(t, i), when = at(d, RISK_HOUR); if (when <= now) continue;
      const names = S.habits.filter((h) => !h.archived && !h.paused && status(S, h, d) === 'At risk').map((h) => h.name);
      if (names.length) plan.push({ id: NOTIF.RISK + i, kind: 'risk', title: 'Habit at risk', body: names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '') + ' need a check-in to stay on track.', at: when });
    }
  }
  if (n.due) {
    const items = S.tasks.filter((k) => isOpen(k) && k.due).map((k) => ({ k, when: k.time ? at(k.due, ...k.time.split(':').map(Number)) - DUE_LEAD_MIN * 60000 : at(k.due, DUE_DEFAULT_HOUR) })).filter((x) => x.when > now).sort((a, b) => a.when - b.when).slice(0, 40);
    for (const { k, when } of items) plan.push({ id: NOTIF.DUE + hash(k.id), kind: 'due', title: 'Task due soon', body: `${k.title} is due ${k.time ? 'at ' + k.time : 'today'}.`, at: when });
  }
  if (n.timer && S.timer?.run) {
    const k = S.tasks.find((x) => x.id === S.timer.id), el = k ? elapsed(S, k) * 1000 : 0;
    if (k && el < TIMER_LONG_MS) plan.push({ id: NOTIF.TIMER, kind: 'timer', title: 'Timer still running', body: `The timer for "${k.title}" has been running for 3 hours.`, at: now + (TIMER_LONG_MS - el) });
  }
  return plan;
}
