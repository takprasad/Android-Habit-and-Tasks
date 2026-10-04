/* Habit & Task Tracker - UI layer. Markup and class names are intentionally identical to the web version. */
import * as L from './logic.js';
import * as store from './storage.js';
import * as nat from './native.js';

const { today, add, esc, WD, hm, safeUrl, isOpen, overdue } = L;
const clock = L.clockStr;
const $ = (s) => document.querySelector(s);

/* ---------- state ---------- */
let S = L.newState();
let bootNotice = '';
async function initApp() {
  try {
    const raw = await store.load();
    S = raw ? L.migrate(raw) : L.newState();
  } catch (err) {
    // Stored data exists but failed validation: keep a copy, never silently overwrite it.
    try { await store.saveBackup(JSON.stringify(await store.load())); } catch { /* ignore */ }
    S = L.newState();
    bootNotice = 'Saved data could not be read. A backup copy was kept.';
  }
  store.init(() => S, (e) => toast('Could not save: ' + (e?.message || e)));
  theme(); L.evaluate(S); store.save(); lastOver = overSig(); render(); sync();
  if (bootNotice) toast(bootNotice);
  nat.hideSplash();
  if (new URLSearchParams(location.search).has('e2e')) window.__ht = { get S() { return S; }, L, store, back: handleBack };
}
let tab = 'today', view = null, origin = 'today', q = '', fil = 'open';
let histLimit = 50;

let syncT;
const sync = () => { clearTimeout(syncT); syncT = setTimeout(() => nat.applyPlan(L.planNotifications(S), S.settings.notif.on), 1500); };
const save = () => { store.save(); sync(); };

/* ---------- engine hooks ---------- */
let celebrated = false;
L.hooks.celebrate = (m) => { celebrated = true; celebrate(m); };
L.hooks.reward = (r) => { if (S.settings.notif.on && S.settings.notif.reward) nat.notifyNow(3000 + (Date.now() % 1000), 'Reward unlocked', r.name); };

/* ---------- UI helpers ---------- */
let tt;
function toast(m, undo) {
  const t = $('#toast'); t.hidden = false; t.innerHTML = `<span>${esc(m)}</span>${undo ? '<button id=undo>Undo</button>' : ''}`;
  if (undo) $('#undo').onclick = () => { undo(); t.hidden = true; };
  clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 5000);
}
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function celebrate(m) {
  toast(m);
  if (reduceMotion()) return;
  const c = document.createElement('div'); c.id = 'confetti'; c.setAttribute('aria-hidden', 'true');
  c.innerHTML = Array.from({ length: 28 }, (_, i) => `<i style="--x:${(i * 37) % 100}vw;--d:${(i % 7) * 60}ms;--r:${(i * 53) % 360}deg;--c:${['var(--ac)', 'var(--am)', 'var(--dg)'][i % 3]}"></i>`).join('');
  document.body.appendChild(c); setTimeout(() => c.remove(), 1800);
}
function ring(n, r, c = 'var(--ac)') {
  const f = r ? Math.min(1, n / r) : 0, Lc = 2 * Math.PI * 26;
  return `<div class=ring role=img aria-label="${n} of ${r}"><svg width=64 height=64><circle cx=32 cy=32 r=26 fill=none stroke="var(--tr)" stroke-width=6 /><circle cx=32 cy=32 r=26 fill=none stroke="${c}" stroke-width=6 stroke-linecap=round stroke-dasharray="${Lc * f} ${Lc}"/></svg><b>${n}/${r}</b></div>`;
}
const bar = (n, r) => `<div class=bar role=progressbar aria-valuenow=${n} aria-valuemax=${r}><i style="width:${r ? Math.min(100, n / r * 100) : 0}%"></i></div>`;
const unit = (h) => h.ms.kind === 'streak' ? (h.type === 'daily' ? 'days' : 'periods') : 'sessions';
const run = (k) => S.timer && S.timer.id === k.id;
const el = (k) => L.elapsed(S, k);

function habitCard(h, act = 'hd') {
  const t = today(), p = L.period(S, h, t), n = L.done(S, h, p), r = L.req(h), dn = L.hDays(S, h).has(t), sch = L.isScheduled(h, t);
  const dis = (!sch && !(dn && !h.multi)) || h.paused;
  return `<div class="card"><div class="row">${ring(n, r)}<div class=grow data-a=${act} data-id=${h.id} style="cursor:pointer"><b>${esc(h.icon || '')} ${esc(h.name)}</b><div class=mu>${L.sched(h)} · ${L.status(S, h)}</div>
  <div class=mu style="margin-top:4px">${h.ms.kind === 'streak' ? 'Streak' : 'Landmark'} <b class=am>${h.prog} / ${h.ms.target}</b> ${unit(h)}</div>${bar(h.prog, h.ms.target)}</div>
  <button class="chk ${dn ? 'done' : ''}" data-a=ci data-id=${h.id} ${dis ? 'disabled' : ''} aria-label="${dn ? 'Undo check-in' : 'Check in'} ${esc(h.name)}">${dn ? '✓' : ''}</button></div></div>`;
}
function taskRow(k) {
  const od = overdue(k), rn = run(k), t = today();
  const dm = k.due === t ? (od ? 'Overdue since ' + k.time : 'Due today') : k.due ? (od ? 'Overdue since ' + (k.due === add(t, -1) ? 'yesterday' : k.due) : 'Due ' + k.due) : 'No deadline';
  return `<div class=row style="padding:8px 0"><button class="chk ${k.status === 'Completed' ? 'done' : ''}" data-a=tc data-id=${k.id} aria-label="Complete ${esc(k.title)}">${k.status === 'Completed' ? '✓' : ''}</button>
  <div class=grow data-a=td data-id=${k.id} style="cursor:pointer"><div>${esc(k.title)}</div><div class="mu ${od ? 'dg' : ''}"><span class="pri-${k.pri}">${k.pri}</span> · ${dm}${k.time && !(od && k.due === t) ? ' ' + k.time : ''}${od ? ' ⚠' : ''}</div></div>${rn ? `<span class="pill ok" role=button tabindex=0 data-a=td data-id=${k.id} data-tick=${k.id} aria-label="Timer running for ${esc(k.title)}. Open task">${clock(el(k))}</span>` : ''}</div>`;
}

/* ---------- views ---------- */
function vToday() {
  const t = today(), d = L.dashboard(S);
  return `<h1>${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</h1>
  ${d.asks.map((h) => `<div class=card><b>${esc(h.name)}</b> missed its period. Reset milestone progress?<div class=row style="margin-top:10px"><button class="btn sm" data-a=rs data-id=${h.id}>Reset</button><button class="btn sm out" data-a=keep data-id=${h.id}>Keep progress</button></div></div>`).join('')}
  <div class=lbl>Habits · ${d.doneHabits} of ${d.habits.length} done today</div>
  ${d.habits.map((h) => habitCard(h, 'hd')).join('') || '<div class=card style="text-align:center;padding:10px"><div class=mu>No habits scheduled today</div><br><button class="btn sm" data-a=nh>Add habit</button></div>'}
  <div class=lbl>Tasks · ${d.dueL.filter((k) => k.due === t).length} due today, ${d.dueL.filter(overdue).length} overdue</div>
  <div class=card>${d.dueL.length + d.anyShow.length ? '' : '<div class=mu style="text-align:center;padding:10px">Nothing due today<br><br><button class="btn sm" data-a=nt>Add task</button></div>'}
  ${d.dueL.map(taskRow).join('')}${d.anyShow.length ? `<div class=lbl>Anytime · no deadline</div>${d.anyShow.map(taskRow).join('')}` : ''}
  ${d.doneTasks ? `<div class=mu style="margin-top:8px">✓ Done today: ${d.doneTasks}</div>` : ''}</div>`;
}
function vHabits() {
  const l = S.habits.filter((h) => !h.archived && h.name.toLowerCase().includes(q.toLowerCase())), ar = S.habits.filter((h) => h.archived);
  return `<div class="row sp"><h1>Habits</h1><button class=ic data-a=nh aria-label="New habit">+</button></div>
  <input type=text id=q placeholder="Search habits" value="${esc(q)}" aria-label="Search habits">
  <div class=lbl></div>${l.map((h) => habitCard(h, 'eh')).join('') || '<p class=mu>No habits yet. Tap + to add one.</p>'}
  ${ar.length ? `<div class=lbl>Archived</div>${ar.map((h) => `<div class="card row sp"><span>${esc(h.name)}</span><button class="btn sm out" data-a=unarch data-id=${h.id}>Restore</button></div>`).join('')}` : ''}`;
}
function vTasks() {
  const l = L.filterTasks(S, q, fil);
  const chips = [['open', 'Open'], ['over', 'Overdue'], ['done', 'Completed'], ['all', 'All']].map(([v, n]) => `<label class=chip><input type=radio name=fil value=${v} ${fil === v ? 'checked' : ''}>${n}</label>`).join('');
  return `<div class="row sp"><h1>Tasks</h1><button class=ic data-a=nt aria-label="New task">+</button></div>
  <input type=text id=q placeholder="Search tasks" value="${esc(q)}" aria-label="Search tasks"><div style="margin:10px 0" id=fil>${chips}</div>
  <div class=card>${l.map(taskRow).join('') || '<span class=mu>No tasks here.</span>'}</div>`;
}
function vRewards() {
  const seg = view?.seg || 'unlocked', R = S.rewards.filter((r) => r.status === seg);
  const up = S.habits.filter((h) => !h.archived && h.ms.reward).map((h) => ({ n: h.ms.reward, src: h.name, p: h.prog / h.ms.target })).concat(S.tasks.filter((k) => k.ms.mode === 'worklog' && k.ms.reward && k.status !== 'Completed').map((k) => ({ n: k.ms.reward, src: k.title, p: L.toward(k) / L.everySec(k) })));
  const ready = S.rewards.filter((r) => r.status === 'unlocked').length;
  const card = (n, s, a) => `<div class="card row"><div class=ic style="display:grid;place-items:center;border-radius:14px">${esc(n[0] || '★')}</div><div class=grow><b>${esc(n)}</b><div class=mu>${esc(s)}</div></div>${a}</div>`;
  return `<h1>Rewards</h1><p class=mu>${ready} ready to claim</p><div class=seg role=radiogroup id=rseg>${['unlocked', 'upcoming', 'claimed'].map((s) => `<label><input type=radio name=rs value=${s} ${seg === s ? 'checked' : ''}>${s[0].toUpperCase() + s.slice(1)}</label>`).join('')}</div>
  ${seg === 'upcoming' ? up.map((u) => card(u.n, u.src, `<span class=am>${Math.round(u.p * 100)}%</span>`)).join('') || '<p class=mu>Set a reward on a habit or task milestone.</p>' :
    R.map((r) => card(r.name, 'From ' + r.src, (seg === 'unlocked' ? (safeUrl(r.url) ? `<a class="btn sm out" style="display:grid;place-items:center" href="${esc(r.url)}" data-a=open data-url="${esc(r.url)}" rel=noopener>Open link</a>` : '') + `<button class="btn sm" data-a=claim data-id=${r.id}>Claim</button>` : '<span class=mu>✓</span>')).replace('class="card row"', 'class="card row" style="flex-wrap:wrap"')).join('') || '<p class=mu>Nothing here yet.</p>'}`;
}
function vStats() {
  const m = view?.m || 'habits', H = S.habits, ev = H.flatMap((h) => h.evals), met = ev.filter((e) => e.ok).length;
  const tk = S.tasks, sec = S.sessions.reduce((a, s) => a + s.dur, 0), cats = {};
  S.sessions.forEach((s) => { const k = tk.find((x) => x.id === s.t); if (k) { const c = k.cat || 'Other'; cats[c] = (cats[c] || 0) + s.dur; } });
  const st = (n, l) => `<div class=card style="flex:1;margin:0"><div class=num style="font-size:28px">${n}</div><div class=mu>${l}</div></div>`;
  const week = ev.slice(-12);
  return `<div class="row sp"><h1>Statistics</h1><button class=ic data-a=tab data-id=settings aria-label=Back>←</button></div><div class=seg id=mseg>${['habits', 'tasks'].map((s) => `<label><input type=radio name=ms value=${s} ${m === s ? 'checked' : ''}>${s[0].toUpperCase() + s.slice(1)}</label>`).join('')}</div>
  ${m === 'habits' ? `<div class=row>${st(S.checkins.length, 'Check-ins')}${st(Math.max(0, ...H.map((h) => h.best)), 'Longest streak')}</div><div class=row style="margin-top:12px">${st(ev.length ? Math.round(met / ev.length * 100) + '%' : '–', 'Completion rate')}${st(H.reduce((a, h) => a + h.completed, 0), 'Milestones')}</div><div class=row style="margin:12px 0">${st(H.reduce((a, h) => a + h.resets, 0), 'Resets')}${st(ev.length - met, 'Periods hindered')}</div>
  <div class=lbl>Periods met vs hindered</div><div class=card><div class=row style="gap:4px;align-items:flex-end;height:60px">${week.map((e) => `<span title="${e.a}" style="flex:1;height:${e.ok ? 100 : 35}%;background:${e.ok ? 'var(--ac)' : 'var(--dg)'};border-radius:4px"></span>`).join('') || '<span class=mu>No evaluated periods yet.</span>'}</div><div class=mu>Teal = met · Red = hindered</div></div>`
    : `<div class=row>${st(tk.length, 'Total')}${st(tk.filter((k) => k.status === 'Completed').length, 'Completed')}</div><div class=row style="margin:12px 0">${st(tk.filter(isOpen).length, 'Open')}${st(tk.filter(overdue).length, 'Overdue')}</div><div class=row>${st((sec / 3600).toFixed(1) + 'h', 'Total hours')}${st(S.sessions.length ? hm(sec / S.sessions.length) : '–', 'Avg session')}</div>
  <div class=lbl>Time by category</div><div class=card>${Object.entries(cats).map(([c, s]) => `<div class="row sp"><span>${esc(c)}</span><b>${hm(s)}</b></div>${bar(s, sec)}`).join('') || '<span class=mu>No time logged.</span>'}</div>`}`;
}
function render() {
  if (tab === 'task' && view?.task) return taskDetail(view.task);
  const v = { today: vToday, habits: vHabits, tasks: vTasks, rewards: vRewards, stats: vStats, settings: vSettings }[tab];
  const fq = document.activeElement?.id === 'q'; $('#app').innerHTML = v();
  if (fq) { const i = $('#q'); i.focus(); i.setSelectionRange(99, 99); }
  const T = [['today', '◉', 'Today'], ['habits', '↻', 'Habits'], ['tasks', '☑', 'Tasks'], ['rewards', '★', 'Rewards'], ['settings', '⚙', 'Settings']];
  $('#tabs').innerHTML = T.map(([k, i, n]) => `<button data-a=tab data-id=${k} ${tab === k ? 'aria-current=page' : ''}><span aria-hidden=true>${i}</span>${n}</button>`).join('');
}

/* ---------- sheets / forms ---------- */
function sheet(h) { const s = $('#sheet'); s.hidden = !h; s.innerHTML = h ? `<div role=dialog aria-modal=true>${h}</div>` : ''; if (h) s.querySelector('input,button')?.focus(); }
const seg = (n, o, v) => `<div class=seg>${o.map((x) => `<label><input type=radio name=${n} value="${x}" ${x === v ? 'checked' : ''}>${x}</label>`).join('')}</div>`;
const fld = (l, i) => `<label class=fld><span>${l}</span>${i}</label>`;
const val = (n) => document.querySelector(`#sheet [name=${n}]:checked`)?.value ?? document.querySelector(`#sheet [name=${n}]`)?.value;
const chk = (n) => !!document.querySelector(`#sheet [name=${n}]`)?.checked;
const CATS = ['Health', 'Work', 'Learning', 'Home', 'Personal'];
const FREQ = { Daily: 'daily', 'X / week': 'weekly', Days: 'days', 'Every N days': 'every', 'N / month': 'monthly' };
const freqLabel = (t) => Object.keys(FREQ).find((k) => FREQ[k] === t);
const closeBtn = '<button class=ic data-a=x aria-label=Close>✕</button>';

function fHabit(h) {
  const e = !!h, type = h ? freqLabel(h.type) : 'X / week', ms = h?.ms || {};
  sheet(`<div class="row sp"><h2 class=num>${e ? 'Edit habit' : 'New habit'}</h2>${closeBtn}</div>
 ${fld('Name', `<input type=text name=name maxlength=60 required value="${esc(h?.name || '')}">`)}
 <div class=lbl>Category</div>${CATS.map((c, i) => `<label class=chip><input type=radio name=cat value=${c} ${(h ? h.cat === c : !i) ? 'checked' : ''}>${c}</label>`).join('')}
 <div class=lbl>Frequency</div>${seg('type', ['Daily', 'X / week', 'Days'], type)}${seg('type', ['Every N days', 'N / month'], type)}
 <div id=fx class="${type === 'X / week' ? '' : 'hide'}">${fld('Days per week (1–7)', `<input type=number name=n min=1 max=7 value="${h?.type === 'weekly' ? h.n : 4}">`)}</div>
 <div id=fd class="${type === 'Days' ? '' : 'hide'}">${WD.map((d, i) => `<label class=chip><input type=checkbox name=day value=${i} ${h?.days.includes(i) ? 'checked' : ''}>${d}</label>`).join('')}</div>
 <div id=fe class="${type === 'Every N days' ? '' : 'hide'}">${fld('Repeat every N days (1–365)', `<input type=number name=ev min=1 max=365 value="${h?.every || 2}">`)}</div>
 <div id=fm class="${type === 'N / month' ? '' : 'hide'}">${fld('Times per month (1–31)', `<input type=number name=nm min=1 max=31 value="${h?.type === 'monthly' ? h.n : 8}">`)}</div>
 ${e ? `<p class=mu>Started ${h.start}</p>` : fld('Start date', `<input type=date name=start value="${today()}">`)}
 <label class=chip><input type=checkbox name=multi ${h?.multi ? 'checked' : ''}>Allow multiple sessions per day</label>
 <div class=lbl>Milestone</div>${seg('kind', ['Streak', 'Count'], ms.kind === 'streak' ? 'Streak' : 'Count')}
 ${fld('Target', `<input type=number name=target min=1 value="${ms.target || 15}">`)}
 <div class=lbl>If I miss a period</div>${seg('policy', ['Reset', 'Pause', 'Ask'], ms.policy ? ms.policy[0].toUpperCase() + ms.policy.slice(1) : 'Reset')}
 ${fld('Reward (optional)', `<input type=text name=reward maxlength=60 value="${esc(ms.reward || '')}">`)}${fld('Reward link (optional, http/https)', `<input type=url name=url value="${esc(ms.url || '')}">`)}
 <button class=btn data-a=sh data-id="${h?.id || ''}">${e ? 'Save changes' : 'Save habit'}</button>`);
}
function saveHabit(id) {
  const name = val('name').trim(); if (!name) return toast('Please enter a name');
  const type = FREQ[val('type')] || 'weekly', days = [...document.querySelectorAll('#sheet [name=day]:checked')].map((i) => +i.value);
  if (type === 'days' && !days.length) return toast('Pick at least one day');
  const url = val('url').trim(); if (url && !safeUrl(url)) return toast('Link must start with http:// or https://');
  const fields = {
    name, cat: val('cat'), type, days: type === 'days' ? days : [],
    n: type === 'monthly' ? Math.min(31, Math.max(1, +val('nm') || 8)) : Math.min(7, Math.max(1, +val('n') || 4)), every: Math.min(365, Math.max(1, Math.round(+val('ev')) || 2)), multi: chk('multi'),
  };
  const ms = { kind: val('kind').toLowerCase(), target: Math.max(1, Math.round(+val('target')) || 1), policy: val('policy').toLowerCase(), reward: val('reward').trim(), url };
  const h = id && S.habits.find((x) => x.id === id);
  if (h) {
    const changed = [];
    for (const k of Object.keys(fields)) if (JSON.stringify(h[k]) !== JSON.stringify(fields[k])) changed.push(k);
    for (const k of Object.keys(ms)) if (h.ms[k] !== ms[k]) changed.push('ms.' + k);
    const sched = ['type', 'n', 'days', 'every'].some((k) => changed.includes(k));
    Object.assign(h, fields); Object.assign(h.ms, ms);
    if (sched) h.evalFrom = L.period(S, h, today())[0]; // a new schedule is never judged retroactively
    if (changed.length) L.log(S, 'habit_edited', h.id, { fields: changed });
    L.checkMs(S, h);
  } else {
    const start = val('start') || today();
    const nh = { id: L.uid(), ...fields, icon: '', start, prog: 0, best: 0, completed: 0, resets: 0, attempts: [], evals: [], attemptStart: start, ms };
    nh.evalFrom = L.period(S, nh, start)[0]; S.habits.push(nh);
    L.log(S, 'habit_created', nh.id);
  }
  save(); sheet(); render();
}
function fTask(k) {
  const e = !!k, ms = k?.ms || {}, after = { reset: 'Reset to 0', carry: 'Carry over', add: 'Keep adding' }[ms.after] || 'Carry over';
  sheet(`<div class="row sp"><h2 class=num>${e ? 'Edit task' : 'New task'}</h2>${closeBtn}</div>
 ${fld('Title', `<input type=text name=title maxlength=100 value="${esc(k?.title || '')}">`)}<div class=lbl>Priority</div>${seg('pri', ['High', 'Medium', 'Low'], k?.pri || 'Medium')}
 <div class=row>${fld('Due date (optional)', `<input type=date name=due value="${k?.due || ''}">`)}${fld('Time (optional)', `<input type=time name=time value="${k?.time || ''}">`)}</div>
 ${fld('Category', `<select name=cat>${CATS.map((c) => `<option ${k?.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select>`)}
 <div class=lbl>Milestone</div>${seg('mode', ['Once on completion', 'Every work log'], ms.mode === 'worklog' ? 'Every work log' : 'Once on completion')}
 <div id=wl class="${ms.mode === 'worklog' ? '' : 'hide'}">${fld('Every N hours worked', `<input type=number name=every min=0.25 step=0.25 value="${ms.every || 5}">`)}<div class=lbl>After each reward</div>${seg('after', ['Reset to 0', 'Carry over', 'Keep adding'], after)}</div>
 ${fld('Reward (optional)', `<input type=text name=reward maxlength=60 value="${esc(ms.reward || '')}">`)}${fld('Reward link (optional)', `<input type=url name=url value="${esc(ms.url || '')}">`)}
 <button class=btn data-a=st data-id="${k?.id || ''}">${e ? 'Save changes' : 'Create task'}</button>`);
}
function saveTask(id) {
  const title = val('title').trim(); if (!title) return toast('Please enter a title'); const url = val('url').trim(); if (url && !safeUrl(url)) return toast('Link must start with http:// or https://');
  const wl = val('mode') === 'Every work log', due = val('due') || null;
  const fields = { title, pri: val('pri'), cat: val('cat'), due, time: due ? val('time') || null : null };
  const ms = { mode: wl ? 'worklog' : 'once', every: Math.max(0.25, +val('every') || 5), after: val('after') === 'Keep adding' ? 'add' : val('after') === 'Carry over' ? 'carry' : 'reset', reward: val('reward').trim(), url };
  const k = id && S.tasks.find((x) => x.id === id);
  if (k) {
    const changed = Object.keys(fields).filter((f) => k[f] !== fields[f]).concat(Object.keys(ms).filter((f) => k.ms[f] !== ms[f]).map((f) => 'ms.' + f));
    Object.assign(k, fields); Object.assign(k.ms, ms); if (changed.length) L.log(S, 'task_edited', k.id, { fields: changed });
    save(); sheet(); tab === 'task' ? taskDetail(k.id) : render(); return;
  }
  const nk = { id: L.uid(), ...fields, status: 'Not Started', start: today(), mp: 0, fired: 0, ms };
  S.tasks.push(nk); L.log(S, 'task_created', nk.id); save(); sheet(); render();
}
function taskDetail(id) {
  const k = S.tasks.find((x) => x.id === id); if (!k) return; view = { task: id }; tab = 'task';
  const rn = run(k), paused = rn && !S.timer.run, ses = S.sessions.filter((s) => s.t === id).sort((a, b) => a.start - b.start);
  const ev = L.everySec(k);
  $('#tabs').hidden = true;
  $('#app').innerHTML = `<div class=row><button class=ic data-a=back aria-label=Back>←</button><h1 style="font-size:24px;margin:0">${esc(k.title)}</h1></div>
  <p class=mu><span class="pri-${k.pri}">${k.pri}</span> · ${esc(k.cat)} · ${k.due ? 'Due ' + k.due + (k.time ? ' ' + k.time : '') : 'No deadline'} · ${k.status}</p>
  <div class=card><div class="timer num" data-tick=${id} aria-live=off>${clock(el(k))}</div><div class=row>
  ${k.status === 'Completed' ? '<button class="btn out" data-a=reopen data-id=' + id + '>Reopen</button>' : rn && S.timer.run ? `<button class="btn out" data-a=pause>Pause</button><button class=btn data-a=stop>Stop &amp; save</button>` : paused ? `<button class=btn data-a=resume>Resume</button><button class="btn out" data-a=stop>Stop &amp; save</button>` : `<button class=btn data-a=start data-id=${id}>Start</button>`}</div></div>
  ${k.ms.mode === 'worklog' ? `<div class=card><b>Milestone</b> <span class=am>${hm(L.toward(k))} / ${k.ms.every}h</span>${bar(L.toward(k), ev)}<div class=mu>${esc(k.ms.reward || '')}</div></div>` : k.ms.reward ? `<div class=card><b>Reward on completion:</b> ${esc(k.ms.reward)}</div>` : ''}
  <div class=lbl>Work log · total ${hm(L.worked(S, k))}</div><div class=card>${ses.map((s) => `<div class="row sp"><span>${new Date(s.start).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} · ${s.type === 'timer' ? 'Timer' : 'Manual'}${s.note ? ' · ' + esc(s.note) : ''}</span><b>${hm(s.dur)}</b></div>`).join('') || '<span class=mu>No sessions yet.</span>'}</div>
  <div class=row><button class="btn out" data-a=lt data-id=${id}>+ Log time</button>${k.status !== 'Completed' ? `<button class=btn data-a=tc data-id=${id}>Mark complete</button>` : ''}</div>
  <div class=row style="margin-top:12px"><button class="btn out" data-a=et data-id=${id}>Edit</button><button class="btn out" data-a=hist data-kind=task data-id=${id}>History</button></div>
  <button class="btn danger" style="margin-top:12px" data-a=dt data-id=${id}>Delete task</button>`;
}
function habitDetail(id) {
  const h = S.habits.find((x) => x.id === id); if (!h) return; const t = today(), p = L.period(S, h, t), set = L.hDays(S, h), ws = L.wk(t, S.settings.weekStart), st = L.status(S, h);
  const order = Array.from({ length: 7 }, (_, i) => L.dow(add(ws, i)));
  const past = Array.from({ length: L.MAX_BACKDATE_DAYS }, (_, i) => add(t, -(i + 1))).filter((d) => !L.checkinBlocked(S, h, d));
  const lbl = (d) => L.P(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
  sheet(`<div class="row sp"><h2 class=num style="margin:0">${esc(h.name)}</h2>${closeBtn}</div>
  <p><span class="pill ${st === 'At risk' ? 'dg' : 'ok'}">${st}</span></p>
  <div class=card><div class=row>${ring(L.done(S, h, p), L.req(h))}<div class=grow><b>${L.sched(h)}</b><div class="days" style="margin-top:8px">${order.map((di, i) => `<i class="${set.has(add(ws, i)) ? 'f' : ''}" title="${WD[di]}">${WD[di][0]}</i>`).join('')}</div></div></div></div>
  <div class=card><span class=mu>${h.ms.kind === 'streak' ? 'Streak' : 'Landmark'}</span><div class=num style="font-size:32px">${h.prog} / ${h.ms.target} <small class=mu>${unit(h)}</small></div>${bar(h.prog, h.ms.target)}<div class=mu>${h.ms.reward ? 'Reward: ' + esc(h.ms.reward) : ''}</div></div>
  <div class=card><b>Log a past day</b><div class=mu style="margin-bottom:8px">Up to ${L.MAX_BACKDATE_DAYS} days back. Recorded in the history.</div>${past.map((d) => `<label class=chip><input type=radio name=bd value=${d}>${esc(lbl(d))}</label>`).join('') || '<div class=mu>No eligible days.</div>'}${past.length ? '<div style="margin-top:6px"><button class="btn sm" data-a=bd data-id=' + id + '>Add check-in</button></div>' : ''}</div>
  <div class=card><b>History</b><div class=mu>${S.checkins.filter((c) => c.h === id).length} check-ins · longest streak ${h.best} · ${h.completed} completed · ${h.resets} resets</div>
  ${h.attempts.slice().reverse().map((a) => `<div class="row sp"><span>${a.s} → ${a.e}</span><b class="${a.state === 'Reset' ? 'dg' : 'ok'}">${a.state} (${a.prog})</b></div>`).join('')}
  <div style="margin-top:10px"><button class="btn sm out" data-a=hist data-kind=habit data-id=${id}>View activity log</button></div></div>
  <div class=row><button class="btn out" data-a=eh data-id=${id}>Edit</button>${h.paused ? `<button class="btn out" data-a=rh data-id=${id}>Resume</button>` : `<button class="btn out" data-a=ph data-id=${id}>Pause</button>`}</div>
  <div class=row style="margin-top:12px"><button class="btn out" data-a=arch data-id=${id}>Archive</button><button class="btn danger" data-a=dh data-id=${id}>Delete</button></div>`);
}
function historySheet(kind, id) {
  const name = kind === 'habit' ? S.habits.find((x) => x.id === id)?.name : S.tasks.find((x) => x.id === id)?.title; if (name == null) return;
  const all = L.auditFor(S, id), rows = all.slice(0, histLimit);
  sheet(`<div class="row sp"><div class=row style="min-width:0">${kind === 'habit' ? `<button class=ic data-a=hd data-id=${id} aria-label=Back>←</button>` : ''}<h2 class=num style="margin:0;font-size:20px">History · ${esc(name)}</h2></div>${closeBtn}</div>
  <div class=card>${rows.map((e) => `<div class="hist-row row sp"><span>${esc(L.describeAudit(e))}</span><span class=mu style="white-space:nowrap">${new Date(e.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span></div>`).join('') || '<span class=mu>No activity yet.</span>'}</div>
  ${all.length > rows.length ? `<button class="btn out" data-a=hmore data-kind=${kind} data-id=${id}>Show more (${all.length - rows.length})</button>` : ''}`);
}
function vSettings() {
  const n = S.settings.notif, days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const c = (name, label, on) => `<label class=chip><input type=checkbox name=${name} ${on ? 'checked' : ''}>${label}</label>`;
  return `<h1>Settings</h1>
 <div class=lbl>Analytics</div>
 <button class="btn out" data-a=tab data-id=stats style="margin-bottom:10px">📊 View Statistics</button>
 <div class=lbl>Theme</div>${seg('theme', ['system', 'light', 'dark'], S.theme)}
 ${fld('Week starts on', `<select name=ws>${[1, 2, 3, 4, 5, 6, 0].map((i) => `<option value=${i} ${S.settings.weekStart === i ? 'selected' : ''}>${days[i]}</option>`).join('')}</select>`)}
 <div class=lbl>Notifications</div>${c('nOn', 'Enable notifications', n.on)}
 <p class=mu>Android asks for permission when you turn this on. Reminders can arrive a few minutes late, so no exact-alarm permission is needed.</p>
 <div id=nopts class="${n.on ? '' : 'hide'}">${c('nDaily', 'Daily reminder', n.daily)}${c('nRisk', 'Habit at risk', n.risk)}${c('nDue', 'Task due soon', n.due)}${c('nTimer', 'Timer running 3h+', n.timer)}${c('nReward', 'Reward unlocked', n.reward)}
 ${fld('Daily reminder time', `<input type=time name=nTime value="${n.dailyTime}">`)}</div>
 <div class=lbl>Your data</div>
 <button class="btn out" data-a=exp style="margin-bottom:10px">Export data (JSON)</button>
 <button class="btn out" data-a=expcsv style="margin-bottom:10px">Export data (CSV)</button>
 <label class="btn out" style="display:grid;place-items:center;margin-bottom:10px;cursor:pointer">Import data<input type=file accept=".json,application/json" id=imp hidden></label>
 <button class="btn danger" data-a=wipe>Delete all data</button>`;
}
let lastBars = null;
function isDark() { return S.theme === 'dark' || (S.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches); }
function theme() {
  const r = document.documentElement; S.theme === 'system' ? r.removeAttribute('data-theme') : r.dataset.theme = S.theme;
  const d = isDark(); if (d !== lastBars) { lastBars = d; nat.setBars(d); }
}

/* ---------- actions ---------- */
const byId = (a, id) => S[a].find((x) => x.id === id);
function afterTask(id) { tab === 'task' ? taskDetail(id) : render(); }
function completeTask(k) {
  celebrated = false; L.complete(S, k); save(); afterTask(k.id);
  if (!celebrated) toast('Task completed', () => { L.reopen(S, k); save(); afterTask(k.id); });
}
function leaveTask() { tab = origin || 'today'; view = null; $('#tabs').hidden = false; render(); }
function doCheckin(h) {
  celebrated = false; const id = L.checkin(S, h); if (!id) return; save(); render();
  if (!celebrated) toast('Checked in', () => { L.undoCheckin(S, h, id); save(); render(); });
}
async function exportJson() { await nat.exportFile('tracker-export-' + today() + '.json', 'application/json', JSON.stringify(S, null, 1)); }
async function exportCsv() { await nat.exportFile('tracker-export-' + today() + '.csv', 'text/csv', L.toCsv(S)); }
async function importFile(file) {
  if (!file) return;
  if (file.size > 50e6) return toast('File too large – nothing was changed');
  let ns; try { ns = L.parseImport(await file.text()); } catch { return toast('Invalid file – nothing was changed'); }
  if (!confirm('Replace all current data with this file?')) return;
  const prev = S; await store.saveBackup(JSON.stringify(prev));
  S = ns; L.evaluate(S); theme(); tab = 'today'; view = null; $('#tabs').hidden = false; sheet(); save(); render();
  toast('Data imported', () => { S = prev; theme(); save(); render(); });
}
function openHabitSheet(kind, id) { histLimit = 50; historySheet(kind, id); }

/* Timer buttons swap in place (Stop -> Start, Pause -> Resume), so a fast double-tap would trigger the opposite action.
 * Ignore a second timer action within 600 ms (monotonic clock, unaffected by system-date changes). */
let lastTimerAct = -1e9;
const timerBusy = () => { const n = performance.now(), busy = n - lastTimerAct < 600; if (!busy) lastTimerAct = n; return busy; };
const A = {
  tab: ({ id, e }) => { e.preventDefault(); tab = id; view = null; $('#tabs').hidden = false; render(); },
  x: () => sheet(), set: () => { tab = 'settings'; view = null; render(); }, nh: ({ e }) => { e.preventDefault(); fHabit(); }, nt: ({ e }) => { e.preventDefault(); fTask(); },
  sh: ({ id }) => saveHabit(id), st: ({ id }) => saveTask(id),
  ci: ({ h, id }) => { if (!h) return; if (L.hDays(S, h).has(today()) && !h.multi) { if (L.undoToday(S, h)) { save(); render(); } } else doCheckin(h); },
  hd: ({ id, e }) => { e.preventDefault(); habitDetail(id); },
  rs: ({ h }) => { L.reset(S, h, 'ask'); save(); render(); }, keep: ({ h }) => { L.keepProgress(S, h); save(); render(); },
  arch: ({ h }) => { h.archived = true; L.log(S, 'habit_archived', h.id); sheet(); save(); render(); },
  unarch: ({ h }) => { L.unarchiveHabit(S, h); save(); render(); },
  dh: ({ h, id, e }) => { e.preventDefault(); if (confirm('Delete this habit and its check-ins?')) { S.habits = S.habits.filter((x) => x !== h); S.checkins = S.checkins.filter((c) => c.h !== id); sheet(); save(); render(); } },
  eh: ({ h }) => fHabit(h), ph: ({ h }) => { L.pauseHabit(S, h); save(); habitDetail(h.id); render(); }, rh: ({ h }) => { L.resumeHabit(S, h); save(); habitDetail(h.id); render(); },
  bd: ({ h }) => {
    const d = val('bd'); if (!d) return toast('Pick a day');
    celebrated = false; const cid = L.checkin(S, h, d); if (!cid) return toast('That day cannot be logged');
    save(); render(); habitDetail(h.id); if (!celebrated) toast('Check-in added for ' + d, () => { L.undoCheckin(S, h, cid); save(); render(); });
  },
  hist: ({ id, b }) => openHabitSheet(b.dataset.kind, id), hmore: ({ id, b }) => { histLimit += 100; historySheet(b.dataset.kind, id); },
  tc: ({ k }) => k.status === 'Completed' ? (L.reopen(S, k), save(), afterTask(k.id)) : completeTask(k),
  td: ({ id, e }) => { e.preventDefault(); if (tab !== 'task') origin = tab; taskDetail(id); }, back: () => leaveTask(),
  et: ({ k }) => fTask(k),
  start: ({ k, id }) => { if (timerBusy()) return; if (S.timer && S.timer.id !== id && !confirm('Another timer is running. Stop it and start this one?')) return; L.startTimer(S, k); save(); taskDetail(id); },
  pause: () => { if (timerBusy()) return; const i = S.timer?.id; L.pauseTimer(S); save(); i && taskDetail(i); }, resume: () => { if (timerBusy()) return; const i = S.timer?.id; L.resumeTimer(S); save(); i && taskDetail(i); },
  stop: () => { if (timerBusy()) return; const i = S.timer?.id; if (!i) return; celebrated = false; L.stopTimer(S); save(); taskDetail(i); },
  reopen: ({ k, id }) => { L.reopen(S, k); save(); taskDetail(id); },
  dt: ({ k, e }) => { e.preventDefault(); if (confirm('Delete this task?')) { L.deleteTask(S, k); save(); leaveTask(); } },
  lt: ({ id }) => sheet(`<div class="row sp"><h2 class=num>Log time</h2>${closeBtn}</div><div class=row>${fld('Hours', '<input type=number name=hh min=0 value=0>')}${fld('Minutes', '<input type=number name=mm min=0 max=59 value=30>')}</div>${fld('Note', '<input type=text name=note>')}<button class=btn data-a=slt data-id=${id}>Save</button>`),
  slt: ({ k, id }) => { const d = (+val('hh') || 0) * 3600 + (+val('mm') || 0) * 60; if (d <= 0) return toast('Enter a duration'); L.addSession(S, k, d, 'manual', val('note')); sheet(); save(); taskDetail(id); },
  claim: ({ id }) => { const r = byId('rewards', id); r.status = 'claimed'; r.claimedAt = Date.now(); L.log(S, 'reward_claimed', id); save(); render(); },
  open: ({ b, e }) => { e.preventDefault(); const u = b.dataset.url; if (safeUrl(u)) nat.openLink(u); },
  exp: exportJson, expcsv: exportCsv,
  wipe: async () => { if (confirm('Delete everything? This cannot be undone.')) { await store.wipe(); S = L.newState(); theme(); tab = 'today'; view = null; $('#tabs').hidden = false; sheet(); nat.applyPlan([], false); render(); } },
};
document.addEventListener('click', (e) => {
  if (e.target.id === 'sheet') return sheet();
  const b = e.target.closest('[data-a]'); if (!b) return; const id = b.dataset.id;
  A[b.dataset.a]?.({ b, e, id, h: byId('habits', id), k: byId('tasks', id) });
});
document.addEventListener('input', (e) => { if (e.target.id === 'q') { q = e.target.value; render(); } });
document.addEventListener('change', async (e) => {
  const n = e.target.name, t = e.target;
  if (n === 'fil') { fil = t.value; render(); } if (n === 'rs') { view = { seg: t.value }; render(); } if (n === 'ms') { view = { m: t.value }; render(); }
  if (n === 'type') { const v = t.value; $('#fx').classList.toggle('hide', v !== 'X / week'); $('#fd').classList.toggle('hide', v !== 'Days'); $('#fe').classList.toggle('hide', v !== 'Every N days'); $('#fm').classList.toggle('hide', v !== 'N / month'); }
  if (n === 'mode') $('#wl').classList.toggle('hide', t.value === 'Once on completion');
  if (n === 'theme') { S.theme = t.value; theme(); save(); }
  if (n === 'ws') { L.evaluate(S); S.settings.weekStart = +t.value; for (const h of S.habits) if (!h.archived && (h.type === 'weekly' || h.type === 'days')) h.evalFrom = L.period(S, h, today())[0]; save(); render(); }
  const N = { nDaily: 'daily', nRisk: 'risk', nDue: 'due', nTimer: 'timer', nReward: 'reward' };
  if (n === 'nOn') {
    if (t.checked) { const p = await nat.notifPermission(true); if (p !== 'granted') { t.checked = false; return toast('Notifications are blocked. Allow them in Android settings.'); } }
    S.settings.notif.on = t.checked; $('#nopts').classList.toggle('hide', !t.checked); save();
  }
  if (N[n]) { S.settings.notif[N[n]] = t.checked; save(); }
  if (n === 'nTime' && /^\d{2}:\d{2}$/.test(t.value)) { S.settings.notif.dailyTime = t.value; save(); }
  if (t.id === 'imp') { const f = t.files[0]; t.value = ''; importFile(f); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') sheet();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role=button][data-a]')) { e.preventDefault(); e.target.click(); }
});
document.addEventListener('focusin', (e) => { if (e.target.matches?.('input:not([type=radio]):not([type=checkbox]),select,textarea')) setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' }), 300); });

/* ---------- back button: sheet -> task detail -> Today -> exit ---------- */
function handleBack() {
  if (!$('#sheet').hidden) { sheet(); return true; }
  if (tab === 'task') { leaveTask(); return true; }
  if (tab !== 'today') { tab = 'today'; view = null; render(); return true; }
  return false;
}
nat.onBack(handleBack);

/* ---------- evaluation triggers: start, resume, date/timezone change, minute tick ---------- */
let lastKey = today() + '|' + L.tzKey(), lastOver = '';
const overSig = () => S.tasks.filter(overdue).map((k) => k.id).join();
function refresh() {
  if (L.evaluate(S)) store.save();
  lastKey = today() + '|' + L.tzKey(); lastOver = overSig();
  if (tab !== 'task') render(); sync();
}
nat.onAppState((active) => { if (active) refresh(); else store.flush(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) store.flush(); else refresh(); });
addEventListener('pagehide', () => store.flush());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', theme);
setInterval(() => {
  document.querySelectorAll('[data-tick]').forEach((n) => { const k = byId('tasks', n.dataset.tick); if (k) n.textContent = clock(el(k)); });
}, 1000);
setInterval(() => { const key = today() + '|' + L.tzKey(); if (key !== lastKey) refresh(); else if (overSig() !== lastOver) { lastOver = overSig(); if (tab !== 'task') render(); } }, 20000);

/* ---------- boot ---------- */
initApp();
