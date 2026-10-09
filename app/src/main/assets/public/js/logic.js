/* Habit & Task Tracker - pure logic (no DOM, no Capacitor).
 * Every function takes the state `S` explicitly and reads time only through `clock`,
 * so the whole engine is unit-testable with a fake clock and any TZ. */

export const clock = { now: () => new Date() };
export const setNow = (fn) => { clock.now = fn; };
export const hooks = { celebrate() {}, reward() {}, notice() {} };

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
export const newState = () => ({ v: 2, coins: 0, habits: [], checkins: [], tasks: [], sessions: [], rewards: [], timer: null, theme: 'system', audit: [], settings: defaultSettings(), freezes: 0, earned: 0, snz: [] });
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

/** Evaluate every finished period of every active habit and overdue task penalties. */
export function evaluate(S) {
  const t = today(); let changed = false;
  for (const k of S.tasks) {
    if (isOpen(k) && k.due && k.due < t) {
      const delayDays = diffDays(k.due, t);
      const baseCoins = (TASK_COINS[k.pri] || 3) + (k.bonusCoins || 0);
      const totalNetPenalty = Math.max(0, delayDays - baseCoins);
      const prev = k.netPenaltyApplied || 0;
      if (totalNetPenalty > prev) {
        const diff = totalNetPenalty - prev;
        S.coins = Math.max(0, (S.coins || 0) - diff);
        k.netPenaltyApplied = totalNetPenalty;
        log(S, 'coin_penalty', k.id, { days: delayDays, penalty: diff, coins: S.coins });
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
        const fz = !ok && (S.freezes || 0) > 0 && h.ms.policy !== 'pause'; // a streak freeze absorbs one miss
        h.evals.push({ a, b, r, n, ok, ...(fz ? { fz: 1 } : {}) });
        if (fz) { S.freezes--; log(S, 'freeze_used', h.id, { a }); hooks.notice(`❄ A streak freeze protected "${h.name}"`); }
        else {
          log(S, ok ? 'period_met' : 'period_missed', h.id, { a, n, r });
          if (ok) { if (h.ms.kind === 'streak' && h.type !== 'daily') bump(S, h, 1); } else if (h.ms.policy === 'reset') reset(S, h, a); else if (h.ms.policy === 'ask') h.ask = a;
        }
        changed = true;
      }
      p = add(b, 1);
    }
    if (h.evalFrom !== p) { h.evalFrom = p; changed = true; }
  }
  const keep = (S.snz || []).filter((x) => x.at > clock.now().getTime() - 6e4);
  if (keep.length !== (S.snz || []).length) { S.snz = keep; changed = true; }
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
  const t = today();
  const baseCoins = (TASK_COINS[k.pri] || 3) + (k.bonusCoins || 0);
  const delayDays = k.due && k.due < t ? diffDays(k.due, t) : 0;
  const earned = Math.max(0, baseCoins - delayDays);
  S.coins = (S.coins || 0) + earned; S.earned = (S.earned || 0) + earned;
  log(S, 'coins_earned', k.id, { earned, coins: S.coins });
  if (S.timer && S.timer.id === k.id) stopTimer(S);
  const nx = spawnNext(S, k), tail = nx ? ` Next one is due ${nx.due}.` : '';
  if (k.ms.mode === 'once' && k.ms.reward && !k.once) { k.once = 1; unlockT(S, k, `🎉 Milestone reached! Earned 🪙 ${earned} Supercoins!${tail}`); }
  else { hooks.celebrate(`🎉 Task completed! Earned 🪙 ${earned} Supercoins.${tail}`); }
}

/* ---------- recurring tasks ---------- */
/** rec = { u: 'day'|'week'|'month', n, days: [0..6 Mon=0], dom }. Returns the first occurrence strictly after `from`. */
export function nextDue(rec, from) {
  const n = Math.max(1, rec.n || 1);
  if (rec.u === 'day') return add(from, n);
  if (rec.u === 'week') {
    if (rec.days && rec.days.length) for (let i = 1; i <= 7; i++) { const d = add(from, i); if (rec.days.includes(dow(d))) return d; }
    return add(from, 7 * n);
  }
  const [y, m, d0] = from.split('-').map(Number), t = new Date(2000, 0, 1, 12);
  t.setFullYear(y, m - 1 + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(rec.dom || d0, last)); return D(t);
}
export const recLabel = (r) => !r ? '' : r.u === 'day' ? (r.n > 1 ? `Every ${r.n} days` : 'Daily') : r.u === 'month' ? (r.n > 1 ? `Every ${r.n} months` : 'Monthly')
  : r.days?.length ? (r.days.length === 5 && r.days.every((d) => d < 5) ? 'Weekdays' : 'Every ' + r.days.map((i) => WD[i]).join(', ')) : (r.n > 1 ? `Every ${r.n} weeks` : 'Weekly');
function cloneTask(k, o) {
  return {
    id: uid(), title: k.title, pri: k.pri, cat: k.cat, tags: [...(k.tags || [])], est: k.est || 0, bonusCoins: k.bonusCoins || 0, due: k.due, time: k.time,
    status: 'Not Started', start: today(), mp: 0, fired: 0, netPenaltyApplied: 0, ms: { ...k.ms }, sub: (k.sub || []).map((x) => ({ id: uid(), t: x.t, d: 0 })),
    ...(k.rec ? { rec: { ...k.rec, days: [...(k.rec.days || [])] } } : {}), ...o,
  };
}
/** After completing a recurring task, queue its next occurrence (never two open instances of one series). */
export function spawnNext(S, k) {
  if (!k.rec || !k.due) return null;
  if (!k.ser) k.ser = k.id;
  if (S.tasks.some((x) => x !== k && x.ser === k.ser && isOpen(x))) return null;
  const t = today(), nd = nextDue(k.rec, k.due > t ? k.due : t);
  const nk = cloneTask(k, { due: nd, ser: k.ser });
  S.tasks.push(nk); log(S, 'task_recurred', nk.id, { due: nd }); return nk;
}
export function duplicateTask(S, k) {
  const nk = cloneTask(k, { title: k.title.slice(0, 90) + ' (copy)' }); if (nk.rec) nk.ser = nk.id;
  S.tasks.push(nk); log(S, 'task_created', nk.id); return nk;
}

/* ---------- subtasks ---------- */
export const subProg = (k) => { const s = k.sub || []; return [s.filter((x) => x.d).length, s.length]; };
export function addSub(k, text) {
  const t = String(text || '').trim().slice(0, 100); if (!t) return null;
  if (!k.sub) k.sub = []; if (k.sub.length >= 50) return null;
  const s = { id: uid(), t, d: 0 }; k.sub.push(s); return s;
}
/** Flip a step. Returns true when this tick finished the last open step. */
export function toggleSub(k, id) {
  const s = (k.sub || []).find((x) => x.id === id); if (!s) return false;
  s.d = s.d ? 0 : 1; const [d, n] = subProg(k); return !!s.d && d === n;
}
export const delSub = (k, id) => { k.sub = (k.sub || []).filter((x) => x.id !== id); };

/* ---------- levels, badges, freezes ---------- */
export const LEVEL_NAMES = ['Beginner', 'Starter', 'Apprentice', 'Achiever', 'Pro', 'Expert', 'Master', 'Legend'];
export const levelOf = (earned) => Math.floor((1 + Math.sqrt(1 + 4 * (earned || 0) / 5)) / 2);
export const levelStart = (lv) => 5 * lv * (lv - 1);
export function levelInfo(S) {
  const earned = S.earned || 0, lv = levelOf(earned), a = levelStart(lv), b = levelStart(lv + 1);
  return { lv, name: LEVEL_NAMES[Math.min(lv - 1, LEVEL_NAMES.length - 1)], earned, a, b, into: earned - a, span: b - a };
}
export function badges(S) {
  const doneT = S.tasks.filter((k) => k.status === 'Completed').length, ck = S.checkins.length, best = Math.max(0, ...S.habits.map((h) => h.best));
  const ms = S.habits.reduce((a, h) => a + h.completed, 0), sec = S.sessions.reduce((a, s) => a + s.dur, 0), claimed = S.rewards.filter((r) => r.status === 'claimed').length;
  const B = (id, icon, name, desc, got) => ({ id, icon, name, desc, got: !!got });
  return [
    B('t1', '✅', 'First step', 'Complete a task', doneT >= 1), B('t10', '🔟', 'Ten down', 'Complete 10 tasks', doneT >= 10), B('t50', '🏆', 'Task master', 'Complete 50 tasks', doneT >= 50),
    B('c1', '🌱', 'Habit seed', 'Check in once', ck >= 1), B('c100', '💯', 'Century', 'Record 100 check-ins', ck >= 100),
    B('s7', '🔥', 'Week streak', 'Reach a progress of 7 on a habit', best >= 7), B('s30', '🌋', 'Month streak', 'Reach a progress of 30 on a habit', best >= 30),
    B('m1', '🎯', 'Milestone', 'Complete a habit milestone', ms >= 1), B('h10', '⏱️', 'Deep work', 'Log 10 hours on tasks', sec >= 36000),
    B('r3', '🎁', 'Treat yourself', 'Claim 3 rewards', claimed >= 3), B('l5', '⭐', 'Level 5', 'Reach level 5', levelOf(S.earned) >= 5),
    B('rec', '🔁', 'On repeat', 'Complete a recurring task', S.tasks.some((k) => k.rec && k.status === 'Completed')),
  ];
}
export const FREEZE_COST = 20, FREEZE_MAX = 3;
/** Returns '' on success, else 'max' | 'coins'. */
export function buyFreeze(S) {
  if ((S.freezes || 0) >= FREEZE_MAX) return 'max';
  if ((S.coins || 0) < FREEZE_COST) return 'coins';
  S.coins -= FREEZE_COST; S.freezes = (S.freezes || 0) + 1; log(S, 'freeze_bought', '', { cost: FREEZE_COST, coins: S.coins }); return '';
}

/* ---------- wallet ledger / weekly review / insights ---------- */
export function ledger(S) {
  const tn = new Map(S.tasks.map((k) => [k.id, k.title])), rn = new Map(S.rewards.map((r) => [r.id, r.name])), out = [];
  for (const e of S.audit) {
    if (e.type === 'coins_earned') out.push({ at: e.at, d: +(e.p?.earned || 0), label: tn.get(e.id) ?? 'Completed task', bal: e.p?.coins });
    else if (e.type === 'coin_penalty') out.push({ at: e.at, d: -(e.p?.penalty || 0), label: 'Overdue: ' + (tn.get(e.id) ?? 'task'), bal: e.p?.coins });
    else if (e.type === 'reward_claimed' && e.p?.cost) out.push({ at: e.at, d: -e.p.cost, label: 'Claimed ' + (rn.get(e.id) ?? 'reward'), bal: e.p.coins });
    else if (e.type === 'freeze_bought') out.push({ at: e.at, d: -(e.p?.cost || 0), label: '❄ Streak freeze', bal: e.p?.coins });
  }
  return out.filter((x) => x.d !== 0).sort((a, b) => b.at - a.at);
}
export function weekReview(S, off = 0) {
  const t = today(), a = add(wk(t, S.settings.weekStart), off * 7), b = add(a, 6), inR = (d) => d >= a && d <= b, dayOf = (ms) => D(new Date(ms));
  const ck = S.checkins.filter((c) => inR(c.d)), doneT = S.tasks.filter((k) => k.status === 'Completed' && k.doneAt && inR(dayOf(k.doneAt)));
  const ev = S.habits.flatMap((h) => h.evals).filter((e) => inR(e.b) && !e.fz), au = S.audit.filter((e) => inR(dayOf(e.at)));
  const days = Array.from({ length: 7 }, (_, i) => { const d = add(a, i); return { d, habits: ck.filter((c) => c.d === d).length, tasks: doneT.filter((k) => dayOf(k.doneAt) === d).length }; });
  const top = days.reduce((m, x) => (x.habits + x.tasks > (m ? m.habits + m.tasks : 0) ? x : m), null);
  return {
    a, b, days, best: top, checkins: ck.length, tasksDone: doneT.length, met: ev.filter((e) => e.ok).length, missed: ev.filter((e) => !e.ok).length,
    sec: S.sessions.filter((s) => inR(dayOf(s.start))).reduce((x, s) => x + s.dur, 0),
    earned: au.filter((e) => e.type === 'coins_earned').reduce((x, e) => x + (e.p?.earned || 0), 0), penalty: au.filter((e) => e.type === 'coin_penalty').reduce((x, e) => x + (e.p?.penalty || 0), 0),
  };
}
/** Map date -> count of check-ins (one habit) or check-ins + completed tasks (all). */
export function dayCounts(S, hid) {
  const m = new Map(), inc = (d) => m.set(d, (m.get(d) || 0) + 1);
  for (const c of S.checkins) if (!hid || c.h === hid) inc(c.d);
  if (!hid) for (const k of S.tasks) if (k.doneAt) inc(D(new Date(k.doneAt)));
  return m;
}
export function weekdayStats(S) { const a = [0, 0, 0, 0, 0, 0, 0]; for (const c of S.checkins) a[dow(c.d)]++; return a; }
/** Median hour of day (0-23) of live check-ins, or null with fewer than 5. */
export function typicalHour(S, hid) {
  const hs = S.checkins.filter((c) => !c.bd && (!hid || c.h === hid)).map((c) => new Date(c.at).getHours()).sort((x, y) => x - y);
  return hs.length >= 5 ? hs[Math.floor(hs.length / 2)] : null;
}
export function setNote(S, id, note, mood) {
  const c = S.checkins.find((x) => x.id === id); if (!c) return false;
  note = String(note || '').trim().slice(0, 300); mood = String(mood || '').slice(0, 8);
  if (note) c.note = note; else delete c.note; if (mood) c.mood = mood; else delete c.mood; return true;
}
export const latestToday = (S, h) => S.checkins.filter((c) => c.h === h.id && c.d === today()).pop();

/* ---------- snooze (kept in state so the notification plan stays the single source of truth) ---------- */
export function addSnooze(S, n, mins = 60) {
  const at = clock.now().getTime() + mins * 60000, ex = n.extra || {};
  S.snz = (S.snz || []).filter((x) => x.at > at - mins * 60000).slice(-19);
  S.snz.push({ id: 2000000 + hash(String(n.title) + at), title: String(n.title || 'Reminder').slice(0, 200), body: String(n.body || '').slice(0, 500), at, kind: String(ex.kind || ''), ref: typeof ex.ref === 'string' ? ex.ref : '' });
}

/* ---------- quick add: "Call mom tomorrow 6pm !high #family ~30m every week" ---------- */
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], DAYN = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const dayIdx = (w) => DAYN.indexOf(w.slice(0, 3).toLowerCase());
const hhmm = (h, m) => pad(h) + ':' + pad(m);
export function parseQuick(input, base = today()) {
  let s = ' ' + String(input || '').replace(/\s+/g, ' ').trim() + ' ';
  const out = { title: '', due: null, time: null, pri: null, tags: [], rec: null, est: 0 };
  const eat = (re, fn) => { const m = re.exec(s); if (!m) return false; s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length); fn(m); return true; };
  s = s.replace(/\s#([\p{L}\p{N}_-]{1,20})(?=\s)/gu, (_, t) => { if (out.tags.length < 8 && !out.tags.includes(t.toLowerCase())) out.tags.push(t.toLowerCase()); return ' '; });
  eat(/\s~\s?(\d+(?:\.\d+)?)\s?(hours?|hrs?|h|minutes?|mins?|m)(?=\s)/i, (m) => { out.est = Math.round(+m[1] * (/^h/i.test(m[2]) ? 60 : 1)); });
  eat(/\s!(high|med|medium|low|h|m|l)(?=\s)/i, (m) => { out.pri = { h: 'High', m: 'Medium', l: 'Low' }[m[1][0].toLowerCase()]; }) ||
    eat(/\sp([123])(?=\s)/i, (m) => { out.pri = ['High', 'Medium', 'Low'][m[1] - 1]; });
  // recurrence first, so "every monday" is not read as a date
  const U = { day: 'day', week: 'week', month: 'month' };
  eat(/\severy\s+weekdays?(?=\s)/i, () => { out.rec = { u: 'week', n: 1, days: [0, 1, 2, 3, 4] }; }) ||
    eat(/\severy\s+(\d+\s+)?(day|week|month)s?(?=\s)/i, (m) => { out.rec = { u: U[m[2].toLowerCase()], n: Math.max(1, Math.min(365, +(m[1] || 1))), days: [] }; }) ||
    eat(/\severy\s+((?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*(?:\s*(?:,|and|&)\s*)?)+)(?=\s)/i, (m) => {
      const days = [...new Set((m[1].match(/[a-z]+/gi) || []).map(dayIdx).filter((i) => i >= 0))].sort(); out.rec = { u: 'week', n: 1, days };
    }) || eat(/\s(daily|weekly|monthly)(?=\s)/i, (m) => { out.rec = { u: { daily: 'day', weekly: 'week', monthly: 'month' }[m[1].toLowerCase()], n: 1, days: [] }; });
  // time
  eat(/\s(?:at\s+|@\s*)?(\d{1,2})(?::(\d{2}))?\s?(am|pm)(?=\s)/i, (m) => { let h = +m[1] % 12; if (/pm/i.test(m[3])) h += 12; if (+m[1] >= 1 && +m[1] <= 12 && (+m[2] || 0) < 60) out.time = hhmm(h, +m[2] || 0); }) ||
    eat(/\s(?:at\s+|@\s*)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/, (m) => { out.time = hhmm(+m[1], +m[2]); });
  // date
  const nextDow = (i) => { for (let n = 1; n <= 7; n++) { const d = add(base, n); if (dow(d) === i) return d; } return base; };
  const md = (mon, day) => { const y = +base.slice(0, 4); let d = `${y}-${pad(mon + 1)}-${pad(day)}`; if (day < 1 || day > 31) return null; if (d < base) d = `${y + 1}-${pad(mon + 1)}-${pad(day)}`; return DATE.test(d) ? d : null; };
  eat(/\s(\d{4}-\d{2}-\d{2})(?=\s)/, (m) => { out.due = m[1]; }) ||
    eat(/\s(?:on\s+|by\s+)?(today|tonight)(?=\s)/i, () => { out.due = base; }) ||
    eat(/\s(?:on\s+|by\s+)?(tomorrow|tmrw|tmr)(?=\s)/i, () => { out.due = add(base, 1); }) ||
    eat(/\sin\s+(\d+)\s+(day|week)s?(?=\s)/i, (m) => { out.due = add(base, +m[1] * (/^w/i.test(m[2]) ? 7 : 1)); }) ||
    eat(/\s(?:(?:on|by|this|next)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?=\s)/i, (m) => { out.due = nextDow(dayIdx(m[1])); }) ||
    eat(/\s(?:on|by|this|next)\s+(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?=\s)/i, (m) => { out.due = nextDow(dayIdx(m[1])); }) ||
    eat(/\s(?:on\s+|by\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?=\s)/i, (m) => { out.due = md(MON.indexOf(m[1].toLowerCase()), +m[2]); }) ||
    eat(/\s(?:on\s+|by\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?=\s)/i, (m) => { out.due = md(MON.indexOf(m[2].toLowerCase()), +m[1]); }) ||
    eat(/\s(?:on\s+|by\s+|the\s+)?(\d{1,2})(?:st|nd|rd|th)(?=\s)/i, (m) => { // "on the 15th": next date with that day of the month
      const day = +m[1]; if (day < 1 || day > 31) return;
      for (let i = 0; i < 13 && !out.due; i++) { const c = new Date(2000, 0, 1, 12); c.setFullYear(+base.slice(0, 4), +base.slice(5, 7) - 1 + i, day); const d = D(c); if (c.getDate() === day && d >= base) out.due = d; }
    });
  if (out.rec && !out.due) { out.due = base; if (out.rec.u === 'week' && out.rec.days.length) for (let n = 0; n < 7; n++) { const d = add(base, n); if (out.rec.days.includes(dow(d))) { out.due = d; break; } } }
  if (out.time && !out.due) out.due = base === today() && out.time <= nowHM() ? add(base, 1) : base;
  if (out.rec?.u === 'month') out.rec.dom = +out.due.slice(8);
  out.title = s.replace(/\s+/g, ' ').trim().replace(/\s(on|by|at|due|for|every)$/i, '').trim().slice(0, 100);
  return out;
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
export function startTimer(S, k, pomo = 0) {
  if (S.timer && S.timer.id !== k.id) stopTimer(S);
  if (S.timer && S.timer.id === k.id) return;
  S.timer = { id: k.id, run: true, at: clock.now().getTime(), acc: 0, ...(pomo ? { pomo } : {}) };
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
export function filterTasks(S, q, fil, tag = '', sort = 'due') {
  let l = S.tasks.filter((k) => k.title.toLowerCase().includes(q.toLowerCase()));
  l = l.filter((k) => fil === 'open' ? isOpen(k) : fil === 'done' ? k.status === 'Completed' : fil === 'over' ? overdue(k) : true);
  if (tag) l = l.filter((k) => (k.tags || []).includes(tag));
  const byDue = (a, b) => (a.due || '9') < (b.due || '9') ? -1 : (a.due || '9') > (b.due || '9') ? 1 : PR[a.pri] - PR[b.pri];
  if (sort === 'pri') return l.sort((a, b) => PR[a.pri] - PR[b.pri] || byDue(a, b));
  if (sort === 'recent') return l.sort((a, b) => (b.last || b.doneAt || 0) - (a.last || a.doneAt || 0));
  return l.sort(byDue);
}
export const allTags = (S) => [...new Set(S.tasks.flatMap((k) => k.tags || []))].sort();

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
  task_recurred: (p) => `Next occurrence created, due ${p?.due}`, freeze_bought: () => 'Streak freeze bought', freeze_used: (p) => `Streak freeze used for the period from ${p?.a}`,
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
  S.freezes = opt(raw.freezes, 0, (v) => num(v, 'freezes', 0, 99));
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
      evals: opt(h.evals, [], (v) => arr(v, 'evals').map((e) => ({ a: date(e.a, 'eval'), b: date(e.b, 'eval'), r: num(e.r, 'eval r'), n: num(e.n, 'eval n'), ok: !!e.ok, ...(e.fz ? { fz: 1 } : {}) }))),
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
      start: opt(k.start, D(), (v) => date(v, 'start')), mp: opt(k.mp, 0, (v) => num(v, 'mp', 0)), fired: opt(k.fired, 0, (v) => num(v, 'fired', 0)), bonusCoins: opt(k.bonusCoins, 0, (v) => num(v, 'bonusCoins', 0)), netPenaltyApplied: opt(k.netPenaltyApplied, 0, (v) => num(v, 'netPenaltyApplied', 0)),
      ms: { mode: oneOf(ms.mode ?? 'once', ['once', 'worklog'], 'ms.mode'), every: opt(ms.every, 5, (v) => num(v, 'every', 0.25, 1e4)), after: oneOf(ms.after ?? 'reset', ['reset', 'carry', 'add'], 'ms.after'), reward: optStr(ms.reward, 'reward', 200), url: optStr(ms.url, 'url') },
    };
    kk.sub = opt(k.sub, [], (v) => arr(v, 'sub').slice(0, 50).map((x) => ({ id: id(x.id, 'subtask'), t: str(x.t, 'subtask', 200), d: x.d ? 1 : 0 })));
    kk.tags = opt(k.tags, [], (v) => arr(v, 'tags').slice(0, 8).map((x) => str(x, 'tag', 30).toLowerCase()));
    kk.est = opt(k.est, 0, (v) => num(v, 'est', 0, 1e5));
    if (k.rec != null) kk.rec = { u: oneOf(k.rec.u, ['day', 'week', 'month'], 'rec'), n: opt(k.rec.n, 1, (v) => num(v, 'rec n', 1, 365)), days: opt(k.rec.days, [], (v) => arr(v, 'rec days').map((x) => num(x, 'rec day', 0, 6))), dom: opt(k.rec.dom, 0, (v) => num(v, 'dom', 0, 31)) };
    if (k.ser != null) kk.ser = id(k.ser, 'series');
    if (k.last != null) kk.last = num(k.last, 'last'); if (k.doneAt != null) kk.doneAt = num(k.doneAt, 'doneAt'); if (k.once) kk.once = 1;
    if (tid.has(kk.id)) bad('duplicate task id'); tid.add(kk.id); return kk;
  });
  S.checkins = opt(raw.checkins, [], (v) => arr(v, 'checkins').map((c) => ({ id: id(c.id, 'checkin'), h: id(c.h, 'checkin habit'), d: date(c.d, 'checkin date'), at: num(c.at, 'checkin at'), tz: optStr(c.tz, 'tz', 80), ...(c.bd ? { bd: 1 } : {}), ...(c.note ? { note: optStr(c.note, 'note', 300) } : {}), ...(c.mood ? { mood: optStr(c.mood, 'mood', 8) } : {}) })));
  S.sessions = opt(raw.sessions, [], (v) => arr(v, 'sessions').map((s) => ({ id: id(s.id, 'session'), t: id(s.t, 'session task'), start: num(s.start, 'start'), dur: num(s.dur, 'dur', 0), type: oneOf(s.type, ['timer', 'manual'], 'session type'), note: optStr(s.note, 'note', 1000) })));
  S.rewards = opt(raw.rewards, [], (v) => arr(v, 'rewards').map((r) => ({ id: id(r.id, 'reward'), name: str(r.name, 'reward name', 200), url: optStr(r.url, 'url'), src: optStr(r.src, 'src', 500), cost: opt(r.cost, 10, (x) => num(x, 'cost', 0)), status: oneOf(r.status, ['unlocked', 'claimed'], 'reward status'), at: num(r.at, 'at'), ...(r.claimedAt != null ? { claimedAt: num(r.claimedAt, 'claimedAt') } : {}) })));
  S.audit = opt(raw.audit, [], (v) => arr(v, 'audit').map((e) => ({ type: str(e.type, 'audit type', 64), id: typeof e.id === 'string' ? e.id : '', p: e.p && typeof e.p === 'object' ? e.p : undefined, at: num(e.at, 'audit at') })));
  S.earned = opt(raw.earned, S.audit.filter((e) => e.type === 'coins_earned').reduce((a, e) => a + (+e.p?.earned || 0), 0), (v) => num(v, 'earned', 0));
  S.snz = opt(raw.snz, [], (v) => arr(v, 'snz').slice(0, 20).map((x) => ({ id: num(x.id, 'snz id', 0, 2147483647), title: str(x.title, 'snz title', 200), body: optStr(x.body, 'snz body', 500), at: num(x.at, 'snz at'), kind: optStr(x.kind, 'snz kind', 20), ref: typeof x.ref === 'string' && ID.test(x.ref) ? x.ref : '' })));
  const t = raw.timer;
  S.timer = t && tid.has(t.id) ? { id: t.id, run: !!t.run, at: num(t.at, 'timer at'), acc: num(t.acc, 'timer acc', 0), ...(t.pomo ? { pomo: num(t.pomo, 'pomo', 1, 180) } : {}) } : null;
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
  for (const c of S.checkins) rows.push(['checkin', c.id, hn.get(c.h) ?? c.h, c.d, '', c.bd ? 'Backdated' : '', 1, c.tz + (c.mood ? '; ' + c.mood : '') + (c.note ? '; ' + c.note : '')]);
  for (const k of S.tasks) rows.push(['task', k.id, k.title, k.due ? k.due + (k.time ? ' ' + k.time : '') : '', k.cat, k.status, worked(S, k), `${k.pri}; seconds worked${k.tags?.length ? '; tags ' + k.tags.join(' ') : ''}${k.rec ? '; repeats: ' + recLabel(k.rec) : ''}${k.est ? '; estimate ' + k.est + ' min' : ''}`]);
  for (const s of S.sessions) rows.push(['session', s.id, tn.get(s.t) ?? s.t, iso(s.start), '', s.type, s.dur, s.note]);
  for (const r of S.rewards) rows.push(['reward', r.id, r.name, iso(r.at), '', r.status, '', r.src]);
  for (const e of S.audit) rows.push(['audit', e.id, hn.get(e.id) ?? tn.get(e.id) ?? '', iso(e.at), '', e.type, '', describeAudit(e)]);
  return '\ufeff' + rows.map(csvRow).join('\r\n') + '\r\n';
}
export const sched = (h) => h.type === 'daily' ? 'Daily' : h.type === 'weekly' ? `${h.n} days / week` : h.type === 'every' ? `Every ${h.every} days` : h.type === 'monthly' ? `${h.n} / month` : h.days.map((i) => WD[i]).join(', ');

/* ---------- notification planner (pure; the plugin layer only applies the plan) ---------- */
export const NOTIF = { DAILY: 1001, TIMER: 1003, POMO: 1004, RISK: 2000, DUE: 100000 };
export const TIMER_LONG_MS = 3 * 3600 * 1000, RISK_HOUR = 18, DUE_LEAD_MIN = 60, DUE_DEFAULT_HOUR = 9;
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 1e6; };
const at = (d, hh, mm = 0) => { const x = P(d); x.setHours(hh, mm, 0, 0); return x.getTime(); };
export function planNotifications(S) {
  const n = S.settings.notif, plan = [], now = clock.now().getTime(), t = today();
  if (!n.on) return plan;
  if (n.daily) { const [hh, mm] = n.dailyTime.split(':').map(Number); plan.push({ id: NOTIF.DAILY, kind: 'daily', title: 'Habit & Task Tracker', body: "Time to check in on today's habits.", act: 'REMIND', repeat: { hour: hh, minute: mm } }); }
  if (n.risk) {
    for (let i = 0; i < 3; i++) {
      const d = add(t, i), when = at(d, RISK_HOUR); if (when <= now) continue;
      const names = S.habits.filter((h) => !h.archived && !h.paused && status(S, h, d) === 'At risk').map((h) => h.name);
      if (names.length) plan.push({ id: NOTIF.RISK + i, kind: 'risk', title: 'Habit at risk', body: names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '') + ' need a check-in to stay on track.', act: 'REMIND', at: when });
    }
  }
  if (n.due) {
    const items = S.tasks.filter((k) => isOpen(k) && k.due).map((k) => ({ k, when: k.time ? at(k.due, ...k.time.split(':').map(Number)) - DUE_LEAD_MIN * 60000 : at(k.due, DUE_DEFAULT_HOUR) })).filter((x) => x.when > now).sort((a, b) => a.when - b.when).slice(0, 40);
    for (const { k, when } of items) plan.push({ id: NOTIF.DUE + hash(k.id), kind: 'due', title: 'Task due soon', body: `${k.title} is due ${k.time ? 'at ' + k.time : 'today'}.`, act: 'TASK', ref: k.id, at: when });
  }
  if (n.timer && S.timer?.run) {
    const k = S.tasks.find((x) => x.id === S.timer.id), el = k ? elapsed(S, k) * 1000 : 0;
    if (k && el < TIMER_LONG_MS) plan.push({ id: NOTIF.TIMER, kind: 'timer', title: 'Timer still running', body: `The timer for "${k.title}" has been running for 3 hours.`, at: now + (TIMER_LONG_MS - el) });
  }
  if (n.timer && S.timer?.run && S.timer.pomo) {
    const k = S.tasks.find((x) => x.id === S.timer.id), f = S.timer.pomo * 60, el = k ? elapsed(S, k) : 0;
    if (k) plan.push({ id: NOTIF.POMO, kind: 'pomo', title: 'Focus block done 🍅', body: `Take a short break from "${k.title}".`, at: now + Math.max(1, (f - (el % f))) * 1000 });
  }
  for (const x of S.snz || []) if (x.at > now) plan.push({ id: x.id, kind: x.kind || 'snooze', title: x.title, body: x.body, act: x.ref ? 'TASK' : 'REMIND', ref: x.ref || undefined, at: x.at });
  return plan;
}
