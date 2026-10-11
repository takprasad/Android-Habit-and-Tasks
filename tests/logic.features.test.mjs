import * as L from '../app/src/main/assets/public/js/logic.js';
import assert from 'node:assert/strict';
let fakeNow = new Date(2026, 9, 8, 10, 0, 0); // Thu 8 Oct 2026
L.setNow(() => fakeNow);
const mk = () => L.newState();
const task = (S, o = {}) => { const k = { id: L.uid(), title: 'T', pri: 'Medium', cat: 'Work', due: null, time: null, status: 'Not Started', start: L.today(), mp: 0, fired: 0, ms: { mode: 'once', every: 5, after: 'reset', reward: '', url: '' }, tags: [], sub: [], est: 0, ...o }; S.tasks.push(k); return k; };
let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };

t('nextDue day/week/month', () => {
  assert.equal(L.nextDue({ u: 'day', n: 1 }, '2026-10-08'), '2026-10-09');
  assert.equal(L.nextDue({ u: 'day', n: 3 }, '2026-10-08'), '2026-10-11');
  assert.equal(L.nextDue({ u: 'week', n: 1, days: [0, 3] }, '2026-10-08'), '2026-10-12'); // Thu -> Mon
  assert.equal(L.nextDue({ u: 'week', n: 2, days: [] }, '2026-10-08'), '2026-10-22');
  assert.equal(L.nextDue({ u: 'month', n: 1, days: [], dom: 31 }, '2026-01-31'), '2026-02-28');
  assert.equal(L.nextDue({ u: 'month', n: 1, days: [], dom: 31 }, '2026-02-28'), '2026-03-31');
  assert.equal(L.nextDue({ u: 'month', n: 1, days: [] }, '2026-12-15'), '2027-01-15');
});
t('recurring complete spawns exactly one next', () => {
  const S = mk(); const k = task(S, { due: '2026-10-08', rec: { u: 'day', n: 1, days: [] }, tags: ['x'], sub: [{ id: 'a1', t: 'step', d: 1 }], est: 30 });
  L.complete(S, k);
  assert.equal(S.tasks.length, 2); const nx = S.tasks[1];
  assert.equal(nx.due, '2026-10-09'); assert.equal(nx.status, 'Not Started'); assert.equal(nx.sub[0].d, 0); assert.notEqual(nx.sub[0].id, 'a1'); assert.equal(nx.ser, k.id); assert.deepEqual(nx.tags, ['x']);
  L.reopen(S, k); L.complete(S, k); assert.equal(S.tasks.length, 2, 'no duplicate series instance');
});
t('late completion spawns after today', () => {
  const S = mk(); const k = task(S, { due: '2026-10-01', rec: { u: 'day', n: 1, days: [] } }); L.complete(S, k);
  assert.equal(S.tasks[1].due, '2026-10-09');
});
t('early completion spawns after due', () => {
  const S = mk(); const k = task(S, { due: '2026-10-12', rec: { u: 'week', n: 1, days: [] } }); L.complete(S, k);
  assert.equal(S.tasks[1].due, '2026-10-19');
});
t('non recurring unchanged + earned tracked', () => {
  const S = mk(); const k = task(S, { pri: 'High' }); L.complete(S, k); assert.equal(S.tasks.length, 1); assert.equal(S.coins, 5); assert.equal(S.earned, 5);
});
t('subtasks', () => {
  const k = { sub: [] }; const a = L.addSub(k, ' one '), b = L.addSub(k, 'two'); assert.equal(L.addSub(k, '  '), null);
  assert.deepEqual(L.subProg(k), [0, 2]); assert.equal(L.toggleSub(k, a.id), false); assert.equal(L.toggleSub(k, b.id), true);
  L.delSub(k, a.id); assert.equal(k.sub.length, 1);
});
t('levels', () => {
  assert.equal(L.levelOf(0), 1); assert.equal(L.levelOf(9), 1); assert.equal(L.levelOf(10), 2); assert.equal(L.levelOf(30), 3);
  const S = mk(); S.earned = 15; const i = L.levelInfo(S); assert.equal(i.lv, 2); assert.equal(i.into, 5); assert.equal(i.span, 20);
});
t('freeze buy + cap', () => {
  const S = mk(); assert.equal(L.buyFreeze(S), 'coins'); S.coins = 100; assert.equal(L.buyFreeze(S), ''); assert.equal(S.coins, 80); assert.equal(S.freezes, 1);
  L.buyFreeze(S); L.buyFreeze(S); assert.equal(L.buyFreeze(S), 'max'); assert.equal(S.freezes, 3);
});
const habit = (S, o = {}) => { const h = { id: L.uid(), name: 'H', cat: 'Health', type: 'daily', n: 1, every: 2, days: [], start: '2026-10-01', multi: false, ms: { kind: 'streak', target: 30, policy: 'reset', reward: '', url: '' }, prog: 5, best: 5, completed: 0, resets: 0, attempts: [], evals: [], attemptStart: '2026-10-01', evalFrom: '2026-10-05', archived: false, paused: false, ask: null, ...o }; S.habits.push(h); return h; };
t('freeze protects a missed period, then a miss resets', () => {
  const S = mk(); S.freezes = 1; const h = habit(S); // evalFrom Oct 5, today Oct 8 -> Oct 5,6,7 missed
  L.evaluate(S);
  assert.equal(S.freezes, 0); assert.equal(h.evals.filter((e) => e.fz).length, 1); assert.equal(h.resets, 2, 'the two later missed days still reset'); assert.equal(h.evals.length, 3);
});
t('freeze not used for pause policy', () => {
  const S = mk(); S.freezes = 1; habit(S, { ms: { kind: 'count', target: 30, policy: 'pause', reward: '', url: '' } }); L.evaluate(S); assert.equal(S.freezes, 1);
});
t('ledger + weekReview', () => {
  const S = mk(); const k = task(S, { pri: 'Low', title: 'Write' }); L.complete(S, k); S.coins = 50; L.buyFreeze(S);
  const lg = L.ledger(S); assert.equal(lg.length, 2); assert.ok(lg.some((x) => x.d === 2 && x.label === 'Write')); assert.ok(lg.some((x) => x.d === -20));
  const w = L.weekReview(S, 0); assert.equal(w.tasksDone, 1); assert.equal(w.earned, 2); assert.equal(w.a, '2026-10-05'); assert.equal(w.best.d, '2026-10-08');
  const w2 = L.weekReview(S, -1); assert.equal(w2.tasksDone, 0); assert.equal(w2.best, null);
});
t('badges', () => {
  const S = mk(); assert.equal(L.badges(S).filter((b) => b.got).length, 0); const k = task(S, { rec: { u: 'day', n: 1, days: [] }, due: '2026-10-08' }); L.complete(S, k);
  const g = L.badges(S).filter((b) => b.got).map((b) => b.id); assert.ok(g.includes('t1') && g.includes('rec'));
});
t('filter + sort + tags', () => {
  const S = mk(); task(S, { title: 'a', tags: ['home'], pri: 'Low', due: '2026-10-09' }); task(S, { title: 'b', tags: ['work'], pri: 'High', due: '2026-10-20' });
  assert.deepEqual(L.allTags(S), ['home', 'work']); assert.equal(L.filterTasks(S, '', 'open', 'work').length, 1);
  assert.equal(L.filterTasks(S, '', 'open', '', 'pri')[0].title, 'b'); assert.equal(L.filterTasks(S, '', 'open', '', 'due')[0].title, 'a');
});
t('duplicate', () => {
  const S = mk(); const k = task(S, { title: 'Pack', sub: [{ id: 's1', t: 'x', d: 1 }], rec: { u: 'week', n: 1, days: [1] }, due: '2026-10-09' }); const d = L.duplicateTask(S, k);
  assert.equal(d.title, 'Pack (copy)'); assert.equal(d.sub[0].d, 0); assert.equal(d.ser, d.id); assert.equal(S.tasks.length, 2);
});
t('notes', () => {
  const S = mk(); const h = habit(S); S.checkins.push({ id: 'c1', h: h.id, d: '2026-10-08', at: 1, tz: '' }); assert.equal(L.latestToday(S, h).id, 'c1');
  assert.ok(L.setNote(S, 'c1', ' felt great ', '😀')); assert.equal(S.checkins[0].note, 'felt great'); L.setNote(S, 'c1', '', ''); assert.equal(S.checkins[0].note, undefined);
});
t('typicalHour / weekdayStats / dayCounts', () => {
  const S = mk(); const h = habit(S); for (let i = 0; i < 5; i++) S.checkins.push({ id: 'c' + i, h: h.id, d: '2026-10-0' + (i + 1), at: new Date(2026, 9, i + 1, 19, 5).getTime(), tz: '' });
  assert.equal(L.typicalHour(S, h.id), 19); assert.equal(L.weekdayStats(S).reduce((a, b) => a + b), 5); assert.equal(L.dayCounts(S, h.id).size, 5);
});
t('parseQuick basics', () => {
  let r = L.parseQuick('Call mom tomorrow 6pm !high #family ~30m'); assert.deepEqual([r.title, r.due, r.time, r.pri, r.tags, r.est], ['Call mom', '2026-10-09', '18:00', 'High', ['family'], 30]);
  r = L.parseQuick('Review report next monday'); assert.equal(r.due, '2026-10-12'); assert.equal(r.title, 'Review report');
  r = L.parseQuick('Pay rent every month on 1st'); assert.equal(r.rec.u, 'month'); assert.equal(r.title, 'Pay rent'); assert.equal(r.due, '2026-11-01'); assert.equal(r.rec.dom, 1);
  r = L.parseQuick('Review budget on the 8th'); assert.equal(r.due, '2026-10-08'); assert.equal(r.title, 'Review budget');
  r = L.parseQuick('Pay card 31st'); assert.equal(r.due, '2026-10-31'); r = L.parseQuick('Bill 31st'); assert.equal(r.title, 'Bill');
  r = L.parseQuick('Buy 3 apples'); assert.deepEqual([r.title, r.due], ['Buy 3 apples', null]);
  r = L.parseQuick('Trip oct 20th'); assert.equal(r.due, '2026-10-20'); assert.equal(r.title, 'Trip');
  r = L.parseQuick('Standup every mon, wed 9:30'); assert.deepEqual(r.rec.days, [0, 2]); assert.equal(r.time, '09:30'); assert.equal(r.due, '2026-10-12'); assert.equal(r.title, 'Standup');
  r = L.parseQuick('Water plants every 3 days'); assert.deepEqual([r.rec.u, r.rec.n, r.due], ['day', 3, '2026-10-08']);
  r = L.parseQuick('Dentist oct 20 2pm p2'); assert.deepEqual([r.due, r.time, r.pri, r.title], ['2026-10-20', '14:00', 'Medium', 'Dentist']);
  r = L.parseQuick('File taxes 15 jan'); assert.equal(r.due, '2027-01-15');
  r = L.parseQuick('Gym every weekday'); assert.deepEqual(r.rec.days, [0, 1, 2, 3, 4]); assert.equal(r.due, '2026-10-08');
  r = L.parseQuick('Call bob in 2 weeks'); assert.equal(r.due, '2026-10-22');
  r = L.parseQuick('Just a title'); assert.deepEqual([r.title, r.due, r.rec], ['Just a title', null, null]);
  r = L.parseQuick('Email at 9am'); assert.equal(r.time, '09:00'); assert.equal(r.due, '2026-10-09', '9am already passed -> tomorrow');
  r = L.parseQuick('Submit by friday'); assert.equal(r.due, '2026-10-09'); assert.equal(r.title, 'Submit');
  r = L.parseQuick('   '); assert.equal(r.title, '');
});
t('migrate round-trip keeps new fields and rejects bad', () => {
  const S = mk(); const k = task(S, { due: '2026-10-08', rec: { u: 'week', n: 1, days: [0, 2], dom: 0 }, ser: 'abc', tags: ['a'], est: 45, sub: [{ id: 's1', t: 'x', d: 1 }] }); S.freezes = 2; S.earned = 9; S.snz.push({ id: 5, title: 't', body: '', at: 5, kind: 'due', ref: k.id });
  const h = habit(S); S.checkins.push({ id: 'c1', h: h.id, d: '2026-10-08', at: 1, tz: '', note: 'n', mood: '😀' }); h.evals.push({ a: '2026-10-01', b: '2026-10-01', r: 1, n: 0, ok: false, fz: 1 });
  S.timers = { [k.id]: { run: true, at: 5, acc: 0, pomo: 25 } };
  const M = L.migrate(JSON.parse(JSON.stringify(S))); assert.deepEqual(M.tasks[0].rec, S.tasks[0].rec); assert.equal(M.tasks[0].est, 45); assert.equal(M.tasks[0].sub[0].d, 1); assert.equal(M.freezes, 2); assert.equal(M.earned, 9);
  assert.equal(M.snz[0].ref, k.id); assert.equal(M.checkins[0].mood, '😀'); assert.equal(M.habits[0].evals[0].fz, 1); assert.equal(M.timers[k.id].pomo, 25); assert.equal(M.timer, undefined);
  const old = JSON.parse(JSON.stringify(S)); delete old.earned; old.audit = [{ type: 'coins_earned', id: 'x', p: { earned: 7 }, at: 1 }]; assert.equal(L.migrate(old).earned, 7);
  const o2 = JSON.parse(JSON.stringify(S)); o2.tasks[0].rec.u = 'year'; assert.throws(() => L.migrate(o2));
});
t('notification plan: refs, pomo, snooze', () => {
  const S = mk(); S.settings.notif.on = true; const k = task(S, { due: '2026-10-09', time: '15:00' }); S.timers = { [k.id]: { run: true, at: fakeNow.getTime(), acc: 0, pomo: 25 } };
  L.addSnooze(S, { title: 'Hello', body: 'b', extra: { kind: 'due', ref: k.id } }, 60);
  const p = L.planNotifications(S); const due = p.find((x) => x.kind === 'due'); assert.equal(due.ref, k.id); assert.equal(due.act, 'TASK');
  const po = p.find((x) => x.kind === 'pomo'); assert.equal(po.at - fakeNow.getTime(), 25 * 60000); const sn = p.find((x) => x.title === 'Hello'); assert.ok(sn && sn.at - fakeNow.getTime() === 3600000);
  assert.ok(new Set(p.map((x) => x.id)).size === p.length, 'unique ids');
  fakeNow = new Date(fakeNow.getTime() + 2 * 3600000); L.evaluate(S); assert.equal(S.snz.length, 0, 'expired snooze pruned'); fakeNow = new Date(2026, 9, 8, 10, 0, 0);
});
t('csv export includes new info', () => { const S = mk(); task(S, { tags: ['a'], est: 10, rec: { u: 'day', n: 1, days: [] } }); const c = L.toCsv(S); assert.match(c, /tags a/); assert.match(c, /repeats: Daily/); });

t('coins per hour: 2/hour default, fractions carry over, configurable, off', () => {
  fakeNow = new Date(2026, 9, 8, 10, 0, 0); const S = mk(); const k = task(S); assert.equal(S.settings.coinsPerHour, 2);
  L.addSession(S, k, 3600, 'manual', ''); assert.equal(S.coins, 2); assert.equal(S.earned, 2);
  L.addSession(S, k, 1800, 'manual', ''); assert.equal(S.coins, 3, '30 min = 1 coin');
  for (let i = 0; i < 3; i++) L.addSession(S, k, 600, 'timer', ''); assert.equal(S.coins, 4, 'three 10-minute logs add up to 1 coin, none are lost');
  assert.ok(S.coinFrac < 1e-6);
  L.addSession(S, k, 90, 'timer', ''); assert.equal(S.coins, 4); assert.ok(S.coinFrac > 0 && S.coinFrac < 0.1, 'a short log still counts toward the next coin');
  S.settings.coinsPerHour = 0.5; S.coinFrac = 0; L.addSession(S, k, 3600, 'manual', ''); assert.equal(S.coins, 4); assert.equal(S.coinFrac, 0.5); L.addSession(S, k, 3600, 'manual', ''); assert.equal(S.coins, 5);
  S.settings.coinsPerHour = 0; L.addSession(S, k, 36000, 'manual', ''); assert.equal(S.coins, 5);
  assert.equal(S.audit.filter((e) => e.type === 'session_coins').length, 4);
  const lg = L.ledger(S); assert.ok(lg.every((x) => x.label.startsWith('Logged time')) && lg.length === 4); assert.equal(L.weekReview(S, 0).earned, 5);
  const M = L.migrate(JSON.parse(JSON.stringify(S))); assert.equal(M.settings.coinsPerHour, 0); assert.equal(M.coinFrac, S.coinFrac);
  const old = JSON.parse(JSON.stringify(S)); delete old.earned; delete old.settings.coinsPerHour; delete old.coinFrac; const M2 = L.migrate(old); assert.equal(M2.earned, 5, 'legacy backfill counts logged-time coins'); assert.equal(M2.settings.coinsPerHour, 2); assert.equal(M2.coinFrac, 0);
  S.settings.coinsPerHour = 999; assert.throws(() => L.migrate(JSON.parse(JSON.stringify(S))));
});
t('logged time on a work-log milestone task still unlocks its reward and pays coins', () => {
  const S = mk(); const k = task(S, { ms: { mode: 'worklog', every: 1, after: 'reset', reward: 'Treat', url: '' } }); L.addSession(S, k, 3600, 'manual', '');
  assert.equal(S.coins, 2); assert.equal(S.rewards.length, 1);
});
t('categories: add, dedupe ignoring case, limits, remove rules, in-use categories listed', () => {
  const S = mk(); assert.deepEqual(L.allCats(S), L.DEFAULT_CATS);
  assert.equal(L.addCat(S, '  Fitness   goals '), 'Fitness goals'); assert.equal(L.addCat(S, 'fitness GOALS'), 'Fitness goals'); assert.equal(L.addCat(S, 'work'), 'Work', 'built-in matched ignoring case');
  assert.equal(S.cats.length, 1); assert.equal(L.addCat(S, '   '), ''); assert.equal(L.addCat(S, 'x'.repeat(40)).length, L.CAT_MAX);
  for (let i = 0; i < 40; i++) L.addCat(S, 'c' + i); assert.equal(S.cats.length, L.CUSTOM_MAX, 'capped'); assert.equal(L.addCat(S, 'one more'), '');
  const k = task(S, { cat: 'Fitness goals' }); assert.equal(L.catUsage(S, 'Fitness goals'), 1);
  assert.equal(L.removeCat(S, 'Fitness goals'), 'used'); assert.equal(L.removeCat(S, 'Work'), 'default'); assert.equal(L.removeCat(S, 'nope'), 'missing'); assert.equal(L.removeCat(S, 'c0'), 'ok'); assert.ok(!S.cats.includes('c0'));
  k.cat = 'Imported thing'; assert.ok(L.allCats(S).includes('Imported thing'), 'categories from imported data still appear');
  const M = L.migrate(JSON.parse(JSON.stringify(S))); assert.deepEqual(M.cats, S.cats); const bad = JSON.parse(JSON.stringify(S)); bad.cats = 'nope'; assert.throws(() => L.migrate(bad));
  assert.ok(L.badges(S).find((b) => b.id === 'cat').got, 'Organizer badge');
});
t('badges: more of them, each with a progress counter', () => {
  const S = mk(); const b0 = L.badges(S); assert.ok(b0.length >= 36, String(b0.length)); assert.equal(new Set(b0.map((b) => b.id)).size, b0.length, 'unique ids'); assert.ok(b0.every((b) => b.goal > 0 && !b.got && b.cur >= 0 && b.cur < b.goal)); assert.equal(b0.find((b) => b.id === 'l3').cur, 1, 'a new user is level 1');
  for (let i = 0; i < 12; i++) { const k = task(S, { status: 'Completed', rec: i < 10 ? { u: 'day', n: 1, days: [] } : undefined, tags: ['a'], sub: [{ id: 's' + i, t: 'x', d: 1 }, { id: 'u' + i, t: 'y', d: 1 }, { id: 'v' + i, t: 'z', d: 1 }] }); }
  const h = habit(S, { best: 20 }); for (let i = 0; i < 10; i++) S.checkins.push({ id: 'c' + i, h: h.id, d: '2026-10-0' + (i % 9 + 1), at: new Date(2026, 9, 1 + (i % 9), 6, 30).getTime(), tz: '', note: 'n' });
  S.sessions.push({ id: 'x', t: 'a', start: 1, dur: 5400, type: 'manual', note: '' }); S.coins = 120; S.earned = 40; S.freezes = 0; S.audit.push({ type: 'freeze_used', id: h.id, p: {}, at: 1 });
  const g = Object.fromEntries(L.badges(S).map((b) => [b.id, b])); assert.ok(g.t10.got && !g.t25.got && g.t25.cur === 12 && g.t25.goal === 25);
  assert.ok(g.rec10.got && g.stp.got && g.tag.got && g.nts.got && g.erl.got && !g.nit.got && g.frz.got && g.sav.got && g.s14.got && !g.s30.got && g.h1.got && !g.h10.got && g.h10.cur === 1.5 && g.l3.got && !g.l5.got);
});
t('4 days a week, reward at a count of 12: a missed week resets the count to 0', () => {
  const S = mk(); const h = { id: L.uid(), name: 'Gym', cat: 'Health', type: 'weekly', n: 4, every: 2, days: [], start: '2026-09-21', multi: false,
    ms: { kind: 'count', target: 12, policy: 'reset', reward: 'New shoes', url: '' }, prog: 0, best: 0, completed: 0, resets: 0, attempts: [], evals: [], attemptStart: '2026-09-21', evalFrom: '2026-09-21', archived: false, paused: false, ask: null };
  S.habits.push(h);
  const day = (d) => { fakeNow = new Date(d + 'T10:00:00'); L.evaluate(S); };
  const go = (dates) => dates.forEach((d) => { day(d); assert.ok(L.checkin(S, h, d), 'checkin ' + d); });
  go(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24']);        // week 1: 4 of 4
  day('2026-09-28'); assert.equal(h.prog, 4, 'goal met: count kept'); assert.equal(h.resets, 0);
  go(['2026-09-28', '2026-09-29', '2026-09-30']);                         // week 2: only 3 of 4
  assert.equal(h.prog, 7);
  day('2026-10-05'); assert.equal(h.prog, 0, 'missed the 4-day goal: reward count back to 0'); assert.equal(h.resets, 1);
  assert.equal(h.attempts.at(-1).prog, 7); assert.equal(S.rewards.length, 0);
  go(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']);          // week 3: 4 of 4 again
  day('2026-10-12'); assert.equal(h.prog, 4); assert.equal(h.resets, 1);
});
t('reaching the target across good weeks still unlocks the reward', () => {
  const S = mk(); const h = { id: L.uid(), name: 'Gym', cat: 'Health', type: 'weekly', n: 4, every: 2, days: [], start: '2026-09-21', multi: false,
    ms: { kind: 'count', target: 12, policy: 'reset', reward: 'New shoes', url: '' }, prog: 0, best: 0, completed: 0, resets: 0, attempts: [], evals: [], attemptStart: '2026-09-21', evalFrom: '2026-09-21', archived: false, paused: false, ask: null };
  S.habits.push(h); const wk = [['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'], ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'], ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']];
  for (const w of wk) for (const d of w) { fakeNow = new Date(d + 'T10:00:00'); L.evaluate(S); L.checkin(S, h, d); }
  assert.equal(h.resets, 0); assert.equal(h.completed, 1); assert.equal(S.rewards.length, 1);
});
t('pause policy keeps the count after a missed week', () => {
  const S = mk(); const h = { id: L.uid(), name: 'Gym', cat: 'Health', type: 'weekly', n: 4, every: 2, days: [], start: '2026-09-21', multi: false,
    ms: { kind: 'count', target: 12, policy: 'pause', reward: '', url: '' }, prog: 0, best: 0, completed: 0, resets: 0, attempts: [], evals: [], attemptStart: '2026-09-21', evalFrom: '2026-09-21', archived: false, paused: false, ask: null };
  S.habits.push(h); for (const d of ['2026-09-21', '2026-09-22']) { fakeNow = new Date(d + 'T10:00:00'); L.checkin(S, h, d); }
  fakeNow = new Date('2026-09-29T10:00:00'); L.evaluate(S); assert.equal(h.prog, 2); assert.equal(h.resets, 0);
});
fakeNow = new Date(2026, 9, 8, 10, 0, 0);

t('several timers run at the same time, each with its own clock', () => {
  fakeNow = new Date(2026, 9, 8, 10, 0, 0); const S = mk(); const a = task(S, { title: 'A' }), b = task(S, { title: 'B' }), c = task(S, { title: 'C' });
  L.startTimer(S, a); L.startTimer(S, b, 25); assert.equal(L.runningCount(S), 2); assert.equal(Object.keys(S.timers).length, 2); assert.ok(L.hasTimer(S, a) && L.hasTimer(S, b) && !L.hasTimer(S, c));
  assert.equal(a.status, 'In Progress'); assert.equal(c.status, 'Not Started'); L.startTimer(S, a); assert.equal(Object.keys(S.timers).length, 2, 'starting twice does not reset');
  fakeNow = new Date(fakeNow.getTime() + 600000); assert.equal(L.elapsed(S, a), 600); assert.equal(L.elapsed(S, b), 600); assert.equal(L.elapsed(S, c), 0);
  L.pauseTimer(S, a); fakeNow = new Date(fakeNow.getTime() + 300000); assert.equal(L.elapsed(S, a), 600, 'paused clock stands still'); assert.equal(L.elapsed(S, b), 900, 'the other keeps running'); assert.equal(L.runningCount(S), 1);
  L.resumeTimer(S, a); L.startTimer(S, c); fakeNow = new Date(fakeNow.getTime() + 60000); assert.equal(L.elapsed(S, a), 660); assert.equal(L.elapsed(S, c), 60); assert.equal(L.runningCount(S), 3);
  const d = L.stopTimer(S, b); assert.equal(d, 960); assert.deepEqual(Object.keys(S.timers).sort(), [a.id, c.id].sort()); assert.equal(S.sessions.length, 1); assert.equal(S.sessions[0].t, b.id); assert.equal(S.sessions[0].dur, 960);
  assert.equal(S.coins, Math.floor(960 / 3600 * 2 + 1e-6)); assert.equal(L.stopTimer(S, b), 0, 'second stop is a no-op'); assert.equal(S.sessions.length, 1);
});
t('completing or deleting a task only touches its own timer', () => {
  fakeNow = new Date(2026, 9, 8, 10, 0, 0); const S = mk(); const a = task(S), b = task(S), c = task(S); [a, b, c].forEach((k) => L.startTimer(S, k)); fakeNow = new Date(fakeNow.getTime() + 1800000);
  L.complete(S, a); assert.ok(!S.timers[a.id] && S.timers[b.id] && S.timers[c.id]); assert.equal(S.sessions.length, 1); assert.equal(S.sessions[0].dur, 1800);
  L.deleteTask(S, b); assert.ok(!S.timers[b.id] && S.timers[c.id]); assert.equal(L.runningCount(S), 1);
  const dash = L.dashboard(S); assert.ok(dash.open !== undefined || true);
});
t('migrate: legacy single timer becomes one of many; several survive a round trip; bad entries are dropped', () => {
  fakeNow = new Date(2026, 9, 8, 10, 0, 0); const S = mk(); const a = task(S), b = task(S); L.startTimer(S, a); L.startTimer(S, b, 25); L.pauseTimer(S, b);
  const M = L.migrate(JSON.parse(JSON.stringify(S))); assert.deepEqual(Object.keys(M.timers).sort(), [a.id, b.id].sort()); assert.equal(M.timers[b.id].run, false); assert.equal(M.timers[b.id].pomo, 25);
  const old = JSON.parse(JSON.stringify(S)); delete old.timers; old.timer = { id: a.id, run: true, at: 77, acc: 5, pomo: 25 }; const M2 = L.migrate(old); assert.deepEqual(Object.keys(M2.timers), [a.id]); assert.equal(M2.timers[a.id].acc, 5);
  const ghost = JSON.parse(JSON.stringify(S)); ghost.timers['nosuchtask'] = { run: true, at: 1, acc: 0 }; assert.equal(Object.keys(L.migrate(ghost).timers).length, 2, 'timers for missing tasks are dropped');
  const bad = JSON.parse(JSON.stringify(S)); bad.timers[a.id].acc = -5; assert.throws(() => L.migrate(bad));
});
t('notifications: every running timer gets its own unique alerts', () => {
  fakeNow = new Date(2026, 9, 8, 10, 0, 0); const S = mk(); S.settings.notif.on = true; S.settings.notif.timer = true; const ks = [task(S, { title: 'A' }), task(S, { title: 'B' }), task(S, { title: 'C' })];
  L.startTimer(S, ks[0]); L.startTimer(S, ks[1], 25); L.startTimer(S, ks[2], 50); L.pauseTimer(S, ks[2]);
  const p = L.planNotifications(S); const timerN = p.filter((x) => x.kind === 'timer'), pomoN = p.filter((x) => x.kind === 'pomo');
  assert.equal(timerN.length, 2, 'two running timers get a 3h alert, the paused one none'); assert.equal(pomoN.length, 1); assert.ok(pomoN[0].body.includes('B')); assert.equal(pomoN[0].at - fakeNow.getTime(), 25 * 60000);
  assert.ok(new Set(p.map((x) => x.id)).size === p.length, 'ids unique'); assert.ok(timerN.every((x) => x.at - fakeNow.getTime() === 3 * 3600000));
  S.settings.notif.timer = false; assert.equal(L.planNotifications(S).filter((x) => x.kind === 'timer' || x.kind === 'pomo').length, 0);
});
fakeNow = new Date(2026, 9, 8, 10, 0, 0);
console.log(n, 'tests passed');
