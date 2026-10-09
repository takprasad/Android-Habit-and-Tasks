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
let readyRes; const ready = new Promise((r) => { readyRes = r; }); // notification actions wait for the stored data to load
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
  readyRes();
  nat.hideSplash();
  if (new URLSearchParams(location.search).has('e2e')) window.__ht = { get S() { return S; }, L, store, back: handleBack };
}
let tab = 'today', view = null, origin = 'today', q = '', fil = 'open';
let tview = 'list', tagF = '', sortBy = 'due', calM = '', calSel = '', qaVal = '';
let histLimit = 50;

let syncT;
const sync = () => { clearTimeout(syncT); syncT = setTimeout(() => nat.applyPlan(L.planNotifications(S), S.settings.notif.on), 1500); };
const save = () => { store.save(); sync(); };

/* ---------- engine hooks ---------- */
let celebrated = false, pendingUndo = null;
L.hooks.notice = (m) => toast(m);
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
  toast(m, pendingUndo);
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
/* Undo = restore a full snapshot of the state (cheap, and covers coins, rewards, audit and recurring spawns). */
const snapshot = () => structuredClone(S);
function restore(snap) {
  S = snap; theme(); save(); sheet();
  if (tab === 'task') { S.tasks.some((x) => x.id === view?.task) ? taskDetail(view.task) : leaveTask(); } else render();
}
const fmtHour = (h) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
const fmtDay = (d) => L.P(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const tagsOf = (v) => [...new Set(String(v || '').split(/[\s,]+/).map((x) => x.replace(/^#/, '').toLowerCase()).filter((x) => /^[\p{L}\p{N}_-]{1,20}$/u.test(x)))].slice(0, 8);
const run = (k) => S.timer && S.timer.id === k.id;
const el = (k) => L.elapsed(S, k);

function heat(counts, weeks = 12) {
  const t = today(), start = add(L.wk(t, S.settings.weekStart), -(weeks - 1) * 7), mx = Math.max(1, ...counts.values());
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const d = add(start, i), n = counts.get(d) || 0, lv = d > t ? 'f' : n ? Math.min(4, Math.ceil(n / mx * 4)) : 0;
    cells += `<i class="h h${lv}" title="${d}: ${n}"></i>`;
  }
  return `<div class=heat role=img aria-label="Activity over the last ${weeks} weeks">${cells}</div>`;
}
function habitCard(h, act = 'hd') {
  const t = today(), p = L.period(S, h, t), n = L.done(S, h, p), r = L.req(h), dn = L.hDays(S, h).has(t), sch = L.isScheduled(h, t);
  const dis = (!sch && !(dn && !h.multi)) || h.paused;
  return `<div class="card"><div class="row">${ring(n, r)}<div class=grow data-a=${act} data-id=${h.id} style="cursor:pointer"><b>${esc(h.icon || '')} ${esc(h.name)}</b><div class=mu>${L.sched(h)} · ${L.status(S, h)}</div>
  <div class=mu style="margin-top:4px">${h.ms.kind === 'streak' ? 'Streak' : 'Landmark'} <b class=am>${h.prog} / ${h.ms.target}</b> ${unit(h)}</div>${bar(h.prog, h.ms.target)}</div>
  <button class="chk ${dn ? 'done' : ''}" data-a=ci data-id=${h.id} ${dis ? 'disabled' : ''} aria-label="${dn ? 'Undo check-in' : 'Check in'} ${esc(h.name)}">${dn ? '✓' : ''}</button></div></div>`;
}
function habitStripItem(h) {
  const t = today(), dn = L.hDays(S, h).has(t), sch = L.isScheduled(h, t);
  const dis = (!sch && !(dn && !h.multi)) || h.paused;
  return `<div class="habit-strip-item">
    <button class="chk ${dn ? 'done' : ''}" data-a=ci data-id=${h.id} ${dis ? 'disabled' : ''} aria-label="${dn ? 'Undo check-in' : 'Check in'} ${esc(h.name)}">${dn ? '✓' : ''}</button>
    <div class="habit-strip-name" data-a=hd data-id=${h.id}>${esc(h.name)}</div>
    ${h.prog > 0 ? `<div class=streak>${h.ms.kind === 'streak' ? '🔥' : '🎯'} ${h.prog}</div>` : ''}
  </div>`;
}
function taskRow(k) {
  const od = overdue(k), rn = run(k), t = today();
  const dm = k.due === t ? (od ? 'Overdue since ' + k.time : 'Due today') : k.due ? (od ? 'Overdue since ' + (k.due === add(t, -1) ? 'yesterday' : k.due) : 'Due ' + k.due) : 'No deadline';
  const bonusTag = k.bonusCoins > 0 ? ` · +🪙 ${k.bonusCoins}` : '';
  const isDone = k.status === 'Completed', [sd, sn] = L.subProg(k);
  const extra = (k.rec ? ' · 🔁' : '') + (sn ? ` · ☑ ${sd}/${sn}` : ''), tg = (k.tags || []).length ? `<div class=tags>${k.tags.map((x) => `<span class=tag>#${esc(x)}</span>`).join('')}</div>` : '';
  return `<div class=row style="padding:5px 0"><button class="chk ${isDone ? 'done' : ''}" data-a=tc data-id=${k.id} ${isDone ? 'disabled' : ''} aria-label="${isDone ? 'Completed' : 'Complete'} ${esc(k.title)}">${isDone ? '✓' : ''}</button>
  <div class=grow data-a=td data-id=${k.id} style="cursor:pointer"><div>${esc(k.title)}</div><div class="mu ${od ? 'dg' : ''}"><span class="pri-${k.pri}">${k.pri}</span>${bonusTag}${extra} · ${dm}${k.time && !(od && k.due === t) ? ' ' + k.time : ''}${od ? ' ⚠' : ''}</div>${tg}</div>${rn ? `<span class="pill ok" role=button tabindex=0 data-a=td data-id=${k.id} data-tick=${k.id} aria-label="Timer running for ${esc(k.title)}. Open task">${clock(el(k))}</span>` : ''}</div>`;
}

/* ---------- views ---------- */
function vToday() {
  const t = today(), tm = add(t, 1), d = L.dashboard(S), openTasks = S.tasks.filter(isOpen);
  const dueToday = openTasks.filter((k) => k.due && k.due <= t), over = openTasks.filter(overdue);

  const getGroupLabel = (d, k) => {
    if (k && overdue(k)) return 'Overdue';
    if (!d) return 'Anytime · no deadline';
    if (d < t) return 'Overdue';
    if (d === t) return 'Today';
    if (d === tm) return 'Tomorrow';
    return L.P(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const sortedTasks = openTasks.slice().sort((a, b) => {
    const oa = overdue(a), ob = overdue(b); if (oa !== ob) return oa ? -1 : 1;
    if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : (a.time || '99') < (b.time || '99') ? -1 : (a.time || '99') > (b.time || '99') ? 1 : L.PR[a.pri] - L.PR[b.pri];
    if (a.due) return -1;
    if (b.due) return 1;
    return L.PR[a.pri] - L.PR[b.pri];
  });

  const taskGroups = new Map();
  for (const k of sortedTasks) {
    const label = getGroupLabel(k.due, k);
    if (!taskGroups.has(label)) taskGroups.set(label, []);
    taskGroups.get(label).push(k);
  }

  let tasksContent = '';
  if (openTasks.length === 0) {
    tasksContent = '<div class=empty><div class=ei>🌤️</div>Nothing on your list.<br><button class="btn sm" data-a=nt style="margin-top:10px">Add a task</button></div>';
  } else {
    for (const [label, list] of taskGroups) {
      tasksContent += `<div class="lbl ${label === 'Overdue' ? 'od' : ''}">${esc(label)}${label === 'Overdue' ? ` · ${list.length}` : ''}</div>${list.map(taskRow).join('')}`;
    }
  }

  return `<div class="row sp"><h1 style="margin:0">${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</h1><div class="coin-pill">Lv ${L.levelInfo(S).lv} · 🪙 ${S.coins || 0}</div></div>
  <p class=mu style="margin:4px 0 0">${(() => { const left = d.habits.length - d.doneHabits, due = dueToday.length; return !left && !due ? (d.habits.length || d.doneTasks ? 'All clear for today 🎉' : 'Nothing planned today') : [left ? `${left} habit${left > 1 ? 's' : ''} to go` : '', due ? `${due} task${due > 1 ? 's' : ''} due` : ''].filter(Boolean).join(' · '); })()}</p>
  ${d.asks.map((h) => `<div class=card><b>${esc(h.name)}</b> missed its period. Reset milestone progress?<div class=row style="margin-top:10px"><button class="btn sm" data-a=rs data-id=${h.id}>Reset</button><button class="btn sm out" data-a=keep data-id=${h.id}>Keep progress</button></div></div>`).join('')}
  <div class=lbl>Habits · ${d.doneHabits} of ${d.habits.length} done today</div>
  ${d.habits.length ? `<div class="habit-strip">${d.habits.map(habitStripItem).join('')}</div>` : '<div class=card style="text-align:center;padding:10px"><div class=mu>No habits scheduled today</div><br><button class="btn sm" data-a=nh>Add habit</button></div>'}
  <div class=lbl>Tasks · ${dueToday.length} due today, ${over.length} overdue</div>
  <div class=card><div class="task-list-scroll">${tasksContent}</div>
  ${d.doneTasks ? `<div class=mu style="margin-top:8px">✓ Done today: ${d.doneTasks}</div>` : ''}</div>`;
}
function vHabits() {
  const l = S.habits.filter((h) => !h.archived && h.name.toLowerCase().includes(q.toLowerCase())), ar = S.habits.filter((h) => h.archived);
  return `<h1>Habits</h1>
  <input type=text id=q placeholder="Search habits" value="${esc(q)}" aria-label="Search habits">
  <div class=lbl></div>${l.map((h) => habitCard(h, 'eh')).join('') || '<div class=empty><div class=ei>🌱</div>No habits yet.<br>Tap + to plant your first one.</div>'}
  ${ar.length ? `<div class=lbl>Archived</div>${ar.map((h) => `<div class="card row sp"><span>${esc(h.name)}</span><button class="btn sm out" data-a=unarch data-id=${h.id}>Restore</button></div>`).join('')}` : ''}`;
}
function vTasks() {
  const quick = `<div class=row style="margin-bottom:10px;gap:8px"><input type=text id=qa maxlength=160 value="${esc(qaVal)}" placeholder='Quick add: Call mom tomorrow' aria-label="Quick add task"><button class="btn sm" data-a=qa style="flex:none">Add</button></div>`;
  const tv = `<div class="seg slim" id=tvseg>${[['list', 'List'], ['cal', 'Calendar']].map(([v, n]) => `<label><input type=radio name=tv value=${v} ${tview === v ? 'checked' : ''}>${n}</label>`).join('')}</div>`;
  if (tview === 'cal') return `<h1>Tasks</h1>${quick}${tv}${vCal()}`;
  const tags = L.allTags(S); if (tagF && !tags.includes(tagF)) tagF = '';
  const l = L.filterTasks(S, q, fil, tagF, sortBy);
  const chips = [['open', 'Open'], ['over', 'Overdue'], ['done', 'Done'], ['all', 'All']].map(([v, n]) => `<label class=chip><input type=radio name=fil value=${v} ${fil === v ? 'checked' : ''}>${n}</label>`).join('');
  const tagChips = tags.length ? `<span class=sepv></span>${tags.map((t) => `<button type=button class="chip ${tagF === t ? 'on' : ''}" data-a=tg data-id="${esc(t)}" aria-pressed=${tagF === t}>#${esc(t)}</button>`).join('')}` : '';
  const sortSel = `<select name=sort aria-label="Sort tasks" class=sortsel>${[['due', 'Due date'], ['pri', 'Priority'], ['recent', 'Recent']].map(([v, n]) => `<option value=${v} ${sortBy === v ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
  const empty = q || tagF || fil !== 'open' ? '<div class=empty><div class=ei>🔍</div>No tasks match.</div>' : '<div class=empty><div class=ei>✨</div>No open tasks.<br>Type one in the quick-add bar above.</div>';
  return `<h1>Tasks</h1>${quick}${tv}
  <div class=row style="gap:8px;margin-bottom:8px"><input type=text id=q placeholder="Search tasks" value="${esc(q)}" aria-label="Search tasks"${''}>${sortSel}</div>
  <div class=chips id=fil>${chips}${tagChips}</div>
  <div class=card>${l.map(taskRow).join('') || empty}</div>`;
}
function vCal() {
  const t = today(), m0 = calM || L.monthStart(t), ws = S.settings.weekStart, first = L.wk(m0, ws), end = L.monthEnd(m0), cells = [];
  for (let d = first; cells.length < 42 && (d <= end || cells.length % 7); d = add(d, 1)) cells.push(d);
  const dueBy = new Map(), ckBy = new Map();
  for (const k of S.tasks) if (k.due) { const o = dueBy.get(k.due) || { open: 0, over: 0, done: 0 }; if (isOpen(k)) overdue(k) ? o.over++ : o.open++; else if (k.status === 'Completed') o.done++; dueBy.set(k.due, o); }
  for (const c of S.checkins) ckBy.set(c.d, (ckBy.get(c.d) || 0) + 1);
  if (!calSel && t.slice(0, 7) === m0.slice(0, 7)) calSel = t;
  const sel = calSel && calSel.slice(0, 7) === m0.slice(0, 7) ? calSel : '';
  const grid = cells.map((d) => {
    const o = dueBy.get(d), dots = (o?.over ? '<i class=r></i>' : '') + (o?.open ? '<i></i>' : '') + (o?.done ? '<i class=d></i>' : '') + (ckBy.get(d) ? '<i class=h></i>' : '');
    return `<button class="cal-d ${d.slice(0, 7) !== m0.slice(0, 7) ? 'out' : ''} ${d === t ? 'today' : ''} ${d === sel ? 'sel' : ''}" data-a=cd data-id=${d} aria-label="${d}">${+d.slice(8)}<span class=dots>${dots}</span></button>`;
  }).join('');
  const hdr = Array.from({ length: 7 }, (_, i) => `<div class=cal-h>${WD[L.dow(add(first, i))][0]}</div>`).join('');
  const selTasks = sel ? S.tasks.filter((k) => k.due === sel).sort((a, b) => (a.time || '99') < (b.time || '99') ? -1 : 1) : [], ckSel = sel ? S.habits.filter((h) => L.hDays(S, h).has(sel)) : [];
  const panel = sel ? `<div class=lbl>${L.P(sel).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</div><div class=card>${selTasks.map(taskRow).join('') || '<span class=mu>No tasks due.</span>'}${ckSel.length ? `<div class=mu style="margin-top:8px">✓ Habits done: ${ckSel.map((h) => esc(h.name)).join(', ')}</div>` : ''}<div style="margin-top:10px"><button class="btn sm" data-a=cadd data-id=${sel}>+ Task on this day</button></div></div>` : '';
  return `<div class="row sp" style="margin-bottom:8px"><button class=ic data-a=cm data-id=-1 aria-label="Previous month">‹</button><b>${L.P(m0).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b><button class=ic data-a=cm data-id=1 aria-label="Next month">›</button></div>
  <div class=cal>${hdr}${grid}</div><div class=mu style="margin-top:6px"><span class=am>●</span> due · <span class=dg>●</span> overdue · ● done · <span class=ok>●</span> habit check-in</div>${panel}`;
}
function vRewards() {
  const seg = view?.seg || 'unlocked', R = S.rewards.filter((r) => r.status === seg);
  const up = S.habits.filter((h) => !h.archived && h.ms.reward).map((h) => ({ n: h.ms.reward, src: h.name, p: h.prog / h.ms.target })).concat(S.tasks.filter((k) => k.ms.mode === 'worklog' && k.ms.reward && k.status !== 'Completed').map((k) => ({ n: k.ms.reward, src: k.title, p: L.toward(k) / L.everySec(k) })));
  const card = (n, s, a, cost) => `<div class="card row"><div class=ic style="display:grid;place-items:center;border-radius:14px;background:var(--tr)">🪙</div><div class=grow><b>${esc(n)}</b><div class=mu>${esc(s)}${cost ? ` · <span style="white-space:nowrap">🪙 ${cost}</span>` : ''}</div></div>${a}</div>`;
  const li = L.levelInfo(S), fz = S.freezes || 0;
  const body = seg === 'badges' ? `<div class=badges>${L.badges(S).map((b) => `<div class="badge ${b.got ? '' : 'lock'}"><div class=bi>${b.icon}</div><b>${esc(b.name)}</b><div class=mu>${esc(b.desc)}</div></div>`).join('')}</div><p class=mu>${L.badges(S).filter((b) => b.got).length} of ${L.badges(S).length} earned</p>`
    : seg === 'upcoming' ? up.map((u) => card(u.n, u.src, `<span class=am>${Math.round(u.p * 100)}%</span>`)).join('') || '<p class=mu>Set a reward on a habit or task milestone.</p>'
    : R.map((r) => {
      const cost = r.cost || 10, canAfford = (S.coins || 0) >= cost;
      const btn = seg === 'unlocked' ? `<button class="${canAfford ? 'btn' : 'btn out'} sm" data-a=claimr data-id=${r.id} ${canAfford ? '' : 'disabled'}>${canAfford ? 'Claim' : 'Need 🪙 ' + cost}</button>` : '<span class=mu>✓ Claimed</span>';
      return card(r.name, 'From ' + r.src, btn, cost);
    }).join('') || '<p class=mu>Nothing here yet.</p>';
  return `<div class="row sp"><div><h1 style="margin:0">Rewards</h1><p class=mu style="margin:4px 0 0">Wallet: <b class=am style="font-size:16px">🪙 ${S.coins || 0} Supercoins</b></p></div><button class="btn out sm" data-a=wal>History</button></div>
  <div class="card lvl" style="margin-top:12px"><div class="row sp"><b>Level ${li.lv} · ${li.name}</b><span class=mu>🪙 ${li.earned} earned in total</span></div>${bar(li.into, li.span)}<div class=mu>${li.b - li.earned} more to reach level ${li.lv + 1}</div></div>
  <div class="card row"><div class=ic style="display:grid;place-items:center;border-radius:14px;background:var(--tr)">❄</div><div class=grow><b>Streak freezes: ${fz} / ${L.FREEZE_MAX}</b><div class=mu>Used automatically when you miss a period.</div></div><button class="btn out sm" data-a=bfz ${fz >= L.FREEZE_MAX || (S.coins || 0) < L.FREEZE_COST ? 'disabled' : ''}>🪙 ${L.FREEZE_COST}</button></div>
  <div class=mu style="margin-top:8px;font-size:12px">Task earnings: <span class="pri-High">High: 🪙 5</span> · <span class="pri-Medium">Medium: 🪙 3</span> · <span class="pri-Low">Low: 🪙 2</span></div>
  <div class=seg role=radiogroup id=rseg style="margin-top:10px">${['unlocked', 'upcoming', 'claimed', 'badges'].map((s) => `<label><input type=radio name=rs value=${s} ${seg === s ? 'checked' : ''}>${s[0].toUpperCase() + s.slice(1)}</label>`).join('')}</div>
  ${body}`;
}
function vStats() {
  const m = view?.m || 'habits', H = S.habits, ev = H.flatMap((h) => h.evals).filter((e) => !e.fz), met = ev.filter((e) => e.ok).length;
  const tk = S.tasks, sec = S.sessions.reduce((a, s) => a + s.dur, 0), cats = {};
  S.sessions.forEach((s) => { const k = tk.find((x) => x.id === s.t); if (k) { const c = k.cat || 'Other'; cats[c] = (cats[c] || 0) + s.dur; } });
  const st = (n, l) => `<div class=card style="flex:1;margin:0"><div class=num style="font-size:28px">${n}</div><div class=mu>${l}</div></div>`;
  const week = ev.slice(-12), head = `<div class="row sp"><h1>Statistics</h1><button class=ic data-a=tab data-id=settings aria-label=Back>←</button></div><div class=seg id=mseg>${['habits', 'tasks', 'week'].map((x) => `<label><input type=radio name=ms value=${x} ${m === x ? 'checked' : ''}>${x === 'week' ? 'Weekly review' : x[0].toUpperCase() + x.slice(1)}</label>`).join('')}</div>`;
  if (m === 'week') {
    const o = view?.w || 0, w = L.weekReview(S, o), mxd = Math.max(1, ...w.days.map((d) => d.habits + d.tasks)), DN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    return `${head}<div class="row sp" style="margin-bottom:12px"><button class=ic data-a=wk data-id=-1 aria-label="Previous week">‹</button><b>${fmtDay(w.a)} – ${fmtDay(w.b)}${o === 0 ? ' (this week)' : ''}</b><button class=ic data-a=wk data-id=1 ${o >= 0 ? 'disabled' : ''} aria-label="Next week">›</button></div>
    <div class=row>${st(w.checkins, 'Check-ins')}${st(w.tasksDone, 'Tasks done')}</div><div class=row style="margin:12px 0">${st(hm(w.sec), 'Time worked')}${st((w.earned - w.penalty >= 0 ? '+' : '−') + Math.abs(w.earned - w.penalty), 'Net 🪙 coins')}</div>
    <div class=card><div class="row sp"><span>Habit periods met</span><b class=ok>${w.met}</b></div><div class="row sp"><span>Habit periods hindered</span><b class=dg>${w.missed}</b></div><div class="row sp"><span>Coins earned / lost to delays</span><b>+${w.earned} / −${w.penalty}</b></div>
    <div class=mu style="margin-top:8px">${w.best ? `Best day: <b>${DN[L.dow(w.best.d)]}</b> with ${w.best.habits} check-in(s) and ${w.best.tasks} task(s).` : 'No activity recorded.'}</div></div>
    <div class=lbl>Activity by day</div><div class=card><div class=row style="gap:6px;align-items:flex-end;height:80px">${w.days.map((d) => `<div style="flex:1;text-align:center"><div title="${d.d}" style="height:${Math.max(4, (d.habits + d.tasks) / mxd * 56)}px;background:${d.habits + d.tasks ? 'var(--ac)' : 'var(--tr)'};border-radius:4px"></div><div class=mu style="font-size:11px">${WD[L.dow(d.d)][0]}</div></div>`).join('')}</div></div>`;
  }
  if (m === 'habits') {
    const wd = L.weekdayStats(S), mx = Math.max(1, ...wd), best = wd.indexOf(Math.max(...wd)), th = L.typicalHour(S), DN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    return `${head}<div class=row>${st(S.checkins.length, 'Check-ins')}${st(Math.max(0, ...H.map((h) => h.best)), 'Longest streak')}</div><div class=row style="margin-top:12px">${st(ev.length ? Math.round(met / ev.length * 100) + '%' : '–', 'Completion rate')}${st(H.reduce((a, h) => a + h.completed, 0), 'Milestones')}</div><div class=row style="margin:12px 0">${st(H.reduce((a, h) => a + h.resets, 0), 'Resets')}${st(ev.length - met, 'Periods hindered')}</div>
  <div class=lbl>Periods met vs hindered</div><div class=card><div class=row style="gap:4px;align-items:flex-end;height:60px">${week.map((e) => `<span title="${e.a}" style="flex:1;height:${e.ok ? 100 : 35}%;background:${e.ok ? 'var(--ac)' : 'var(--dg)'};border-radius:4px"></span>`).join('') || '<span class=mu>No evaluated periods yet.</span>'}</div><div class=mu>Teal = met · Red = hindered</div></div>
  <div class=lbl>Check-ins by weekday</div><div class=card><div class=row style="gap:6px;align-items:flex-end;height:70px">${wd.map((n, i) => `<div style="flex:1;text-align:center"><div title="${n}" style="height:${Math.max(4, n / mx * 50)}px;background:${i === best && n ? 'var(--ac)' : 'var(--tr)'};border-radius:4px"></div><div class=mu style="font-size:11px">${WD[i][0]}</div></div>`).join('')}</div>
  <div class=mu>${S.checkins.length ? `Strongest day: <b>${DN[best]}</b>` : 'No check-ins yet.'}${th != null ? ` · you usually check in around ${fmtHour(th)}` : ''}</div></div>
  <div class=lbl>Last 12 weeks</div><div class=card>${heat(L.dayCounts(S))}<div class=mu style="margin-top:6px">Check-ins and completed tasks per day</div></div>`;
  }
  const est = tk.filter((k) => k.est && k.status === 'Completed' && L.worked(S, k) > 0), acc = est.length ? Math.round(est.reduce((a, k) => a + L.worked(S, k) / (k.est * 60), 0) / est.length * 100) : null;
  return `${head}<div class=row>${st(tk.length, 'Total')}${st(tk.filter((k) => k.status === 'Completed').length, 'Completed')}</div><div class=row style="margin:12px 0">${st(tk.filter(isOpen).length, 'Open')}${st(tk.filter(overdue).length, 'Overdue')}</div><div class=row>${st((sec / 3600).toFixed(1) + 'h', 'Total hours')}${st(S.sessions.length ? hm(sec / S.sessions.length) : '–', 'Avg session')}</div>
  <div class=lbl>Time by category</div><div class=card>${Object.entries(cats).map(([c, s]) => `<div class="row sp"><span>${esc(c)}</span><b>${hm(s)}</b></div>${bar(s, sec)}`).join('') || '<span class=mu>No time logged.</span>'}</div>
  <div class=lbl>Estimates vs actual</div><div class=card>${acc == null ? '<span class=mu>Add a time estimate to a task and log time on it to see how accurate you are.</span>' : `Across ${est.length} completed task(s) you worked <b>${acc}%</b> of the time you estimated. ${acc > 115 ? 'You tend to underestimate.' : acc < 85 ? 'You tend to overestimate.' : 'Nicely calibrated!'}`}</div>`;
}
function render() {
  if (tab === 'task' && view?.task) return taskDetail(view.task);
  const v = { today: vToday, habits: vHabits, tasks: vTasks, rewards: vRewards, stats: vStats, settings: vSettings }[tab];
  const fq = document.activeElement?.id === 'q';
  const fabAction = { habits: 'nh', tasks: 'nt', rewards: 'nr' }[tab];
  const fabHtml = fabAction ? `<button class="fab-btn" data-a=${fabAction} aria-label="Add new item">+</button>` : '';
  $('#app').innerHTML = v() + fabHtml;
  if (fq) { const i = $('#q'); i.focus(); i.setSelectionRange(99, 99); }
  const T = [['today', '◉', 'Today'], ['habits', '↻', 'Habits'], ['tasks', '☑', 'Tasks'], ['rewards', '★', 'Rewards'], ['settings', '⚙', 'Settings']];
  $('#tabs').innerHTML = T.map(([k, i, n]) => `<button data-a=tab data-id=${k} ${tab === k ? 'aria-current=page' : ''}><span aria-hidden=true>${i}</span>${n}</button>`).join('');
}

/* ---------- sheets / forms ---------- */
function sheet(h) { const s = $('#sheet'); s.hidden = !h; document.body.classList.toggle('sheet-open', !!h); s.innerHTML = h ? `<div role=dialog aria-modal=true>${h}</div>` : ''; if (h) s.querySelector('input,button')?.focus(); }
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
 <details class=more style="margin-top:16px" ${e ? 'open' : ''}><summary>Milestone, missed periods &amp; reward</summary>
 <div class=lbl style="margin-top:12px">Milestone</div>${seg('kind', ['Streak', 'Count'], ms.kind === 'streak' ? 'Streak' : 'Count')}
 ${fld('Target', `<input type=number name=target min=1 value="${ms.target || 15}">`)}
 <div class=lbl>If I miss a period</div>${seg('policy', ['Reset', 'Pause', 'Ask'], ms.policy ? ms.policy[0].toUpperCase() + ms.policy.slice(1) : 'Reset')}
 ${fld('Reward (optional)', `<input type=text name=reward maxlength=60 value="${esc(ms.reward || '')}">`)}${fld('Reward link (optional, http/https)', `<input type=url name=url value="${esc(ms.url || '')}">`)}
 </details>
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
function fTask(k, preset) {
  const e = !!k, ms = k?.ms || {}, after = { reset: 'Reset to 0', carry: 'Carry over', add: 'Keep adding' }[ms.after] || 'Carry over', rec = k?.rec, rl = rec ? { day: 'Days', week: 'Weeks', month: 'Months' }[rec.u] : 'None';
  sheet(`<div class="row sp"><h2 class=num>${e ? 'Edit task' : 'New task'}</h2>${closeBtn}</div>
 ${fld('Title', `<input type=text name=title maxlength=100 value="${esc(k?.title || '')}">`)}<div class=lbl>Priority</div>${seg('pri', ['High', 'Medium', 'Low'], k?.pri || 'Medium')}
 <div class=row>${fld('Due date (optional)', `<input type=date name=due value="${k?.due || preset?.due || ''}">`)}${fld('Time (optional)', `<input type=time name=time value="${k?.time || ''}">`)}</div>
 <div class=chips style="margin:-6px 0 12px">${[['0', 'Today'], ['1', 'Tomorrow'], ['7', 'Next week'], ['x', 'No date']].map(([v, n]) => `<button type=button class=chip data-a=qd data-id=${v}>${n}</button>`).join('')}</div>
 ${fld('Category', `<select name=cat>${CATS.map((c) => `<option ${k?.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select>`)}
 <details class=more ${(k && (k.tags?.length || k.est || k.rec || k.bonusCoins || ms.mode === 'worklog' || ms.reward || ms.url)) ? 'open' : ''}><summary>More options · tags, repeat, estimate, rewards</summary>
 ${fld('Tags (comma separated)', `<input type=text name=tags maxlength=120 placeholder="home, errands" value="${esc((k?.tags || []).join(', '))}">`)}
 ${fld('Time estimate in minutes (optional)', `<input type=number name=est min=0 value="${k?.est || ''}">`)}
 <div class=lbl>Repeat</div>${seg('rep', ['None', 'Days', 'Weeks', 'Months'], rl)}
 <div id=rp class="${rec ? '' : 'hide'}">${fld('Every N (days / weeks / months)', `<input type=number name=rn min=1 max=365 value="${rec?.n || 1}">`)}<div id=rw class="${rec?.u === 'week' ? '' : 'hide'}">${WD.map((d, i) => `<label class=chip><input type=checkbox name=rday value=${i} ${rec?.days?.includes(i) ? 'checked' : ''}>${d}</label>`).join('')}</div><p class=mu>Repeating tasks need a due date. The next one is created when you complete this one.</p></div>
 <div class=lbl>Milestone</div>${seg('mode', ['Once on completion', 'Every work log'], ms.mode === 'worklog' ? 'Every work log' : 'Once on completion')}
 <div id=wl class="${ms.mode === 'worklog' ? '' : 'hide'}">${fld('Every N hours worked', `<input type=number name=every min=0.25 step=0.25 value="${ms.every || 5}">`)}<div class=lbl>After each reward</div>${seg('after', ['Reset to 0', 'Carry over', 'Keep adding'], after)}</div>
 ${fld('Reward (optional)', `<input type=text name=reward maxlength=60 value="${esc(ms.reward || '')}">`)}${fld('Additional bonus Supercoins reward (optional)', `<input type=number name=bonusCoins min=0 value="${k?.bonusCoins || 0}">`)}${fld('Reward link (optional)', `<input type=url name=url value="${esc(ms.url || '')}">`)}
 </details>
 <button class=btn data-a=st data-id="${k?.id || ''}">${e ? 'Save changes' : 'Create task'}</button>`);
}
function fReward() {
  sheet(`<div class="row sp"><h2 class=num>New reward</h2>${closeBtn}</div>
 ${fld('Reward name', '<input type=text name=rname maxlength=100 placeholder="e.g. Watch a movie, Buy a book">')}
 ${fld('Price (Supercoins)', '<input type=number name=rcost min=1 value=10>')}
 ${fld('Link URL (optional)', '<input type=url name=rurl placeholder="https://...">')}
 <button class=btn data-a=sr>Create reward</button>`);
}
function saveReward() {
  const name = val('rname').trim(); if (!name) return toast('Please enter a reward name');
  const cost = Math.max(1, Math.round(+val('rcost')) || 10);
  const url = val('rurl').trim(); if (url && !safeUrl(url)) return toast('Link must start with http:// or https://');
  const r = { id: L.uid(), name, cost, url, src: 'Custom Reward', status: 'unlocked', at: Date.now() };
  S.rewards.push(r); L.log(S, 'reward_created', r.id, { cost }); save(); sheet(); render();
}
function mkTask(f, ms) {
  const id = L.uid();
  return { id, title: f.title, pri: f.pri || 'Medium', cat: f.cat || 'Personal', due: f.due || null, time: f.time || null, bonusCoins: f.bonusCoins || 0, tags: f.tags || [], est: f.est || 0, rec: f.rec || null, ...(f.rec ? { ser: id } : {}),
    status: 'Not Started', start: today(), mp: 0, fired: 0, sub: [], ms: ms || { mode: 'once', every: 5, after: 'reset', reward: '', url: '' } };
}
function saveTask(id) {
  const title = val('title').trim(); if (!title) return toast('Please enter a title'); const url = val('url').trim(); if (url && !safeUrl(url)) return toast('Link must start with http:// or https://');
  const wl = val('mode') === 'Every work log', due = val('due') || null, ru = { Days: 'day', Weeks: 'week', Months: 'month' }[val('rep')];
  if (ru && !due) return toast('Repeating tasks need a due date');
  const rec = ru ? { u: ru, n: Math.min(365, Math.max(1, Math.round(+val('rn')) || 1)), days: ru === 'week' ? [...document.querySelectorAll('#sheet [name=rday]:checked')].map((i) => +i.value).sort() : [], dom: ru === 'month' ? +due.slice(8) : 0 } : null;
  const fields = { title, pri: val('pri'), cat: val('cat'), due, time: due ? val('time') || null : null, bonusCoins: Math.max(0, Math.round(+val('bonusCoins')) || 0), tags: tagsOf(val('tags')), est: Math.max(0, Math.round(+val('est')) || 0), rec };
  const ms = { mode: wl ? 'worklog' : 'once', every: Math.max(0.25, +val('every') || 5), after: val('after') === 'Keep adding' ? 'add' : val('after') === 'Carry over' ? 'carry' : 'reset', reward: val('reward').trim(), url };
  const k = id && S.tasks.find((x) => x.id === id);
  if (k) {
    const changed = Object.keys(fields).filter((f) => JSON.stringify(k[f] ?? null) !== JSON.stringify(fields[f])).concat(Object.keys(ms).filter((f) => k.ms[f] !== ms[f]).map((f) => 'ms.' + f));
    Object.assign(k, fields); Object.assign(k.ms, ms); if (k.rec && !k.ser) k.ser = k.id; if (changed.length) L.log(S, 'task_edited', k.id, { fields: changed });
    save(); sheet(); tab === 'task' ? taskDetail(k.id) : render(); return;
  }
  const nk = mkTask(fields, ms);
  S.tasks.push(nk); L.log(S, 'task_created', nk.id); save(); sheet(); render();
}
function pomoText(k) { const f = (S.timer?.pomo || 25) * 60, e = el(k); const r = Math.ceil(f - (e % f)); return `🍅 ${Math.floor(e / f)} done · break in ${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`; }
function taskDetail(id) {
  const k = S.tasks.find((x) => x.id === id); if (!k) return; view = { task: id }; tab = 'task';
  const rn = run(k), paused = rn && !S.timer.run, ses = S.sessions.filter((s) => s.t === id).sort((a, b) => a.start - b.start);
  const ev = L.everySec(k), [sd, sn] = L.subProg(k), wsec = L.worked(S, k) + el(k);
  $('#tabs').hidden = true;
  $('#app').innerHTML = `<div class=row><button class=ic data-a=back aria-label=Back>←</button><h1 style="font-size:24px;margin:0">${esc(k.title)}</h1></div>
  <p class=mu><span class="pri-${k.pri}">${k.pri}</span> · ${esc(k.cat)} · ${k.due ? 'Due ' + k.due + (k.time ? ' ' + k.time : '') : 'No deadline'} · ${k.status}${k.rec ? ' · 🔁 ' + L.recLabel(k.rec) : ''}</p>
  ${(k.tags || []).length ? `<p class=mu style="margin-top:-8px">${k.tags.map((x) => '#' + esc(x)).join(' ')}</p>` : ''}
  <div class=card><div class="timer num" data-tick=${id} aria-live=off>${clock(el(k))}</div>${rn && S.timer.pomo ? `<div class=mu style="text-align:center;margin-bottom:8px" data-pomo=${id}>${pomoText(k)}</div>` : ''}<div class=row>
  ${k.status === 'Completed' ? '' : rn && S.timer.run ? `<button class="btn out" data-a=pause>Pause</button><button class=btn data-a=stop>Stop &amp; save</button>` : paused ? `<button class=btn data-a=resume>Resume</button><button class="btn out" data-a=stop>Stop &amp; save</button>` : `<button class=btn data-a=start data-id=${id}>Start</button><button class="btn out" data-a=startp data-id=${id}>🍅 Focus</button>`}</div></div>
  ${k.est ? `<div class=card><div class="row sp"><b>Estimate</b><span class=mu>${hm(k.est * 60)} planned · ${hm(wsec)} worked (${Math.round(wsec / (k.est * 60) * 100)}%)</span></div>${bar(wsec, k.est * 60)}</div>` : ''}
  <div class=lbl>Steps${sn ? ` · ${sd}/${sn}` : ''}</div><div class=card>${(k.sub || []).map((x) => `<div class=row style="padding:4px 0"><button class="chk ${x.d ? 'done' : ''}" data-a=sub data-id=${id} data-sid=${x.id} aria-label="${x.d ? 'Undo' : 'Complete'} step ${esc(x.t)}">${x.d ? '✓' : ''}</button><div class=grow style="${x.d ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(x.t)}</div><button class=ic data-a=sdel data-id=${id} data-sid=${x.id} aria-label="Delete step ${esc(x.t)}">✕</button></div>`).join('')}${sn ? bar(sd, sn) : ''}<div class=row style="margin-top:8px"><input type=text id=sn maxlength=100 placeholder="Add a step" aria-label="Add a step"><button class="btn sm" data-a=sadd data-id=${id}>Add</button></div></div>
  ${k.ms.mode === 'worklog' ? `<div class=card><b>Milestone</b> <span class=am>${hm(L.toward(k))} / ${k.ms.every}h</span>${bar(L.toward(k), ev)}<div class=mu>${esc(k.ms.reward || '')}</div></div>` : k.ms.reward ? `<div class=card><b>Reward on completion:</b> ${esc(k.ms.reward)}</div>` : ''}
  <div class=lbl>Work log · total ${hm(L.worked(S, k))}</div><div class=card>${ses.map((s) => `<div class="card row sp" style="margin:6px 0;padding:10px 12px;background:var(--sf)"><div><div style="font-weight:600;font-size:13px">${new Date(s.start).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} · <span class=mu>${s.type === 'timer' ? 'Timer' : 'Manual'}</span></div>${s.note ? `<div class=mu style="margin-top:3px;font-size:12px;color:var(--tx)">💬 ${esc(s.note)}</div>` : ''}</div><b class=am style="font-size:14px">${hm(s.dur)}</b></div>`).join('') || '<span class=mu>No sessions yet.</span>'}</div>
  <div class=row><button class="btn out" data-a=lt data-id=${id}>+ Log time</button>${k.status !== 'Completed' ? `<button class=btn data-a=tc data-id=${id}>Mark complete</button>` : ''}</div>
  <div class=row style="margin-top:12px"><button class="btn out" data-a=et data-id=${id}>Edit</button><button class="btn out" data-a=dup data-id=${id}>Duplicate</button><button class="btn out" data-a=hist data-kind=task data-id=${id}>History</button></div>
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
  <div class=card><b>Activity · last 12 weeks</b><div style="margin-top:8px">${heat(L.dayCounts(S, id))}</div>${L.typicalHour(S, id) != null ? `<div class=mu style="margin-top:6px">You usually check in around ${fmtHour(L.typicalHour(S, id))}.</div>` : ''}</div>
  <div class=card><b>Check-in notes</b>${(() => {
    const lt = L.latestToday(S, h), recent = S.checkins.filter((c) => c.h === id && (c.note || c.mood)).slice(-5).reverse();
    return `${lt ? `<div class=mu style="margin:4px 0 8px">How did today go?</div>${['', '😀', '🙂', '😐', '🙁', '😫'].map((m) => `<label class=chip><input type=radio name=mood value="${m}" ${(lt.mood || '') === m ? 'checked' : ''}>${m || '—'}</label>`).join('')}<div class=row style="margin-top:6px"><input type=text name=hnote maxlength=300 placeholder="Add a note" value="${esc(lt.note || '')}"><button class="btn sm" data-a=hnote data-id=${id}>Save</button></div>` : '<div class=mu style="margin:4px 0">Check in today to add a note or mood.</div>'}
    ${recent.map((c) => `<div class="hist-row row sp"><span>${esc(c.mood || '')} ${esc(c.note || '')}</span><span class=mu>${c.d}</span></div>`).join('')}`;
  })()}</div>
  <button class="btn out" data-a=shr data-id=${id} style="margin-bottom:12px">Share progress</button>
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
 <button class="btn out" data-a=tab data-id=stats style="margin-bottom:10px">📊 Statistics &amp; weekly review</button>
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
  const snap = snapshot(); pendingUndo = () => restore(snap);
  try { L.complete(S, k); } finally { pendingUndo = null; }
  save(); afterTask(k.id);
}
function startT(k, id, pomo) {
  if (timerBusy()) return; if (S.timer && S.timer.id !== id && !confirm('Another timer is running. Stop it and start this one?')) return;
  L.startTimer(S, k, pomo); save(); taskDetail(id);
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
  nr: () => fReward(), sr: () => saveReward(),
  claimr: ({ id }) => { const r = byId('rewards', id); if (L.claimReward(S, r)) { save(); render(); toast(`Claimed "${r.name}" for 🪙 ${r.cost || 10}!`); } else { toast(`Not enough Supercoins! Need 🪙 ${r.cost || 10}`); } },
  tab: ({ id, e }) => { e.preventDefault(); tab = id; view = null; $('#tabs').hidden = false; render(); },
  x: () => sheet(), set: () => { tab = 'settings'; view = null; render(); }, nh: ({ e }) => { e.preventDefault(); fHabit(); }, nt: ({ e }) => { e.preventDefault(); fTask(undefined, tab === 'tasks' && tview === 'cal' && calSel ? { due: calSel } : undefined); },
  sh: ({ id }) => saveHabit(id), st: ({ id }) => saveTask(id),
  ci: ({ h, id }) => { if (!h) return; if (L.hDays(S, h).has(today()) && !h.multi) { if (L.undoToday(S, h)) { save(); render(); } } else doCheckin(h); },
  hd: ({ id, e }) => { e.preventDefault(); habitDetail(id); },
  rs: ({ h }) => { L.reset(S, h, 'ask'); save(); render(); }, keep: ({ h }) => { L.keepProgress(S, h); save(); render(); },
  arch: ({ h }) => { h.archived = true; L.log(S, 'habit_archived', h.id); sheet(); save(); render(); },
  unarch: ({ h }) => { L.unarchiveHabit(S, h); save(); render(); },
  dh: ({ h, id, e }) => { e.preventDefault(); if (confirm('Delete this habit and its check-ins?')) { const snap = snapshot(); S.habits = S.habits.filter((x) => x !== h); S.checkins = S.checkins.filter((c) => c.h !== id); sheet(); save(); render(); toast('Habit deleted', () => restore(snap)); } },
  eh: ({ h }) => fHabit(h), ph: ({ h }) => { L.pauseHabit(S, h); save(); habitDetail(h.id); render(); }, rh: ({ h }) => { L.resumeHabit(S, h); save(); habitDetail(h.id); render(); },
  bd: ({ h }) => {
    const d = val('bd'); if (!d) return toast('Pick a day');
    celebrated = false; const cid = L.checkin(S, h, d); if (!cid) return toast('That day cannot be logged');
    save(); render(); habitDetail(h.id); if (!celebrated) toast('Check-in added for ' + d, () => { L.undoCheckin(S, h, cid); save(); render(); });
  },
  hist: ({ id, b }) => openHabitSheet(b.dataset.kind, id), hmore: ({ id, b }) => { histLimit += 100; historySheet(b.dataset.kind, id); },
  tc: ({ k }) => k.status === 'Completed' ? null : completeTask(k),
  td: ({ id, e }) => { e.preventDefault(); if (tab !== 'task') origin = tab; taskDetail(id); }, back: () => leaveTask(),
  et: ({ k }) => fTask(k),
  start: ({ k, id }) => startT(k, id, 0), startp: ({ k, id }) => startT(k, id, 25),
  pause: () => { if (timerBusy()) return; const i = S.timer?.id; L.pauseTimer(S); save(); i && taskDetail(i); }, resume: () => { if (timerBusy()) return; const i = S.timer?.id; L.resumeTimer(S); save(); i && taskDetail(i); },
  stop: () => {
    if (timerBusy()) return; const id = S.timer?.id; if (!id) return;
    const k = byId('tasks', id); const dur = L.elapsed(S, k);
    sheet(`<div class="row sp"><h2 class=num>Save timer session</h2>${closeBtn}</div><p class=mu>Logged <b>${clock(dur)}</b> for "${esc(k.title)}"</p>${fld('Message / Note (optional)', '<input type=text name=note maxlength=200 placeholder="What did you work on?">')}<button class=btn data-a=sstop data-id=${id}>Save session</button>`);
  },
  sstop: ({ k, id }) => {
    if (!S.timer) return sheet();
    const note = val('note').trim(); celebrated = false;
    const dur = L.elapsed(S, k);
    S.timer = null;
    if (k && dur >= 1) L.addSession(S, k, dur, 'timer', note);
    sheet(); save(); taskDetail(id);
  },
  reopen: ({ k, id }) => { L.reopen(S, k); save(); taskDetail(id); },
  dt: ({ k, e }) => { e.preventDefault(); const snap = snapshot(); L.deleteTask(S, k); save(); leaveTask(); toast('Task deleted', () => restore(snap)); },
  lt: ({ id }) => sheet(`<div class="row sp"><h2 class=num>Log time</h2>${closeBtn}</div><div class=row>${fld('Hours', '<input type=number name=hh min=0 value=0>')}${fld('Minutes', '<input type=number name=mm min=0 max=59 value=30>')}</div>${fld('Message / Note (optional)', '<input type=text name=note maxlength=200 placeholder="What did you work on?">')}<button class=btn data-a=slt data-id=${id}>Save time log</button>`),
  slt: ({ k, id }) => { const d = (+val('hh') || 0) * 3600 + (+val('mm') || 0) * 60; if (d <= 0) return toast('Enter a duration'); const note = val('note').trim(); L.addSession(S, k, d, 'manual', note); sheet(); save(); taskDetail(id); },
  claim: ({ id }) => { const r = byId('rewards', id); r.status = 'claimed'; r.claimedAt = Date.now(); L.log(S, 'reward_claimed', id); save(); render(); },
  open: ({ b, e }) => { e.preventDefault(); const u = b.dataset.url; if (safeUrl(u)) nat.openLink(u); },
  /* quick add, steps, duplicate */
  qa: () => {
    const i = $('#qa'), r = L.parseQuick(i?.value || ''); if (!r.title) return toast('Type a task first, e.g. "Call mom tomorrow 6pm !high"');
    const snap = snapshot(), nk = mkTask({ title: r.title, pri: r.pri || 'Medium', due: r.due, time: r.due ? r.time : null, tags: r.tags, est: r.est, rec: r.rec });
    S.tasks.push(nk); L.log(S, 'task_created', nk.id); qaVal = ''; save(); render();
    toast(`Added "${r.title}"${r.due ? ' · due ' + r.due + (r.time ? ' ' + r.time : '') : ''}${r.rec ? ' · 🔁 ' + L.recLabel(r.rec) : ''}`, () => restore(snap));
  },
  sub: ({ k, b }) => { const all = L.toggleSub(k, b.dataset.sid); save(); taskDetail(k.id); if (all && k.status !== 'Completed') toast('All steps done. Mark the task complete?'); },
  sadd: ({ k }) => { if (L.addSub(k, $('#sn')?.value)) { save(); taskDetail(k.id); $('#sn')?.focus(); } else toast('Type a step first (max 50 steps)'); },
  sdel: ({ k, b }) => { L.delSub(k, b.dataset.sid); save(); taskDetail(k.id); },
  dup: ({ k }) => { const nk = L.duplicateTask(S, k); save(); toast('Task duplicated'); taskDetail(nk.id); },
  tg: ({ id }) => { tagF = tagF === id ? '' : id; render(); },
  qd: ({ id }) => { const i = document.querySelector('#sheet [name=due]'); if (i) i.value = id === 'x' ? '' : add(today(), +id); },
  /* calendar */
  cd: ({ id }) => { calSel = id; render(); },
  cm: ({ id }) => { const m = calM || L.monthStart(today()); calM = +id > 0 ? add(L.monthEnd(m), 1) : L.monthStart(add(m, -1)); calSel = calM.slice(0, 7) === today().slice(0, 7) ? today() : ''; render(); },
  cadd: ({ id }) => fTask(undefined, { due: id }),
  /* wallet, freezes, review */
  wal: () => {
    const rows = L.ledger(S).slice(0, 100);
    sheet(`<div class="row sp"><h2 class=num>Wallet history</h2>${closeBtn}</div><p class=mu>Balance: <b class=am>🪙 ${S.coins || 0}</b></p><div class=card>${rows.map((x) => `<div class="hist-row row sp"><div class=grow><div>${esc(x.label)}</div><div class=mu>${new Date(x.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</div></div><b class="${x.d > 0 ? 'ok' : 'dg'}">${x.d > 0 ? '+' : '−'}${Math.abs(x.d)}</b></div>`).join('') || '<span class=mu>No coin activity yet.</span>'}</div>`);
  },
  bfz: () => { const r = L.buyFreeze(S); if (r === 'max') return toast('You already hold the maximum number of freezes'); if (r === 'coins') return toast(`Need 🪙 ${L.FREEZE_COST} for a streak freeze`); save(); render(); toast('❄ Streak freeze added'); },
  wk: ({ id }) => { view = { m: 'week', w: Math.min(0, (view?.w || 0) + +id) }; render(); },
  /* habit notes + sharing */
  hnote: ({ h }) => { const lt = L.latestToday(S, h); if (!lt) return; L.setNote(S, lt.id, val('hnote'), val('mood')); save(); habitDetail(h.id); toast('Note saved'); },
  shr: async ({ h }) => { const r = await nat.shareText(h.name, `${h.ms.kind === 'streak' ? '🔥' : '🎯'} ${h.name}: ${h.prog} / ${h.ms.target} ${unit(h)} (best ${h.best}) · tracked with Habit & Task Tracker`); if (r === 'copied') toast('Copied to clipboard'); },
  exp: exportJson, expcsv: exportCsv,
  wipe: async () => { if (confirm('Delete everything? This cannot be undone.')) { await store.wipe(); S = L.newState(); theme(); tab = 'today'; view = null; $('#tabs').hidden = false; sheet(); nat.applyPlan([], false); render(); } },
};
document.addEventListener('click', (e) => {
  if (e.target.id === 'sheet') return sheet();
  const b = e.target.closest('[data-a]'); if (!b) return; const id = b.dataset.id;
  A[b.dataset.a]?.({ b, e, id, h: byId('habits', id), k: byId('tasks', id) });
});
document.addEventListener('input', (e) => { if (e.target.id === 'q') { q = e.target.value; render(); } if (e.target.id === 'qa') qaVal = e.target.value; });
document.addEventListener('change', async (e) => {
  const n = e.target.name, t = e.target;
  if (n === 'fil') { fil = t.value; render(); } if (n === 'rs') { view = { seg: t.value }; render(); } if (n === 'ms') { view = { m: t.value }; render(); }
  if (n === 'type') { const v = t.value; $('#fx').classList.toggle('hide', v !== 'X / week'); $('#fd').classList.toggle('hide', v !== 'Days'); $('#fe').classList.toggle('hide', v !== 'Every N days'); $('#fm').classList.toggle('hide', v !== 'N / month'); }
  if (n === 'tv') { tview = t.value; render(); } if (n === 'tag') { tagF = t.value; render(); } if (n === 'sort') { sortBy = t.value; render(); }
  if (n === 'rep') { $('#rp').classList.toggle('hide', t.value === 'None'); $('#rw').classList.toggle('hide', t.value !== 'Weeks'); }
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
  if (e.key === 'Enter' && e.target.id === 'qa') { e.preventDefault(); A.qa(); }
  if (e.key === 'Enter' && e.target.id === 'sn') { e.preventDefault(); document.querySelector('[data-a=sadd]')?.click(); }
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
/* Notification buttons: Mark done completes the task, Snooze re-plans the same reminder in an hour, tapping opens the task. */
nat.onNotifAction(async ({ actionId, notification }) => {
  await ready; const ex = notification?.extra || {}, k = ex.ref ? byId('tasks', ex.ref) : null;
  if (actionId === 'snooze') { L.addSnooze(S, notification, 60); save(); toast('Snoozed for 1 hour'); }
  else if (actionId === 'done' && k && isOpen(k)) completeTask(k);
  else if (actionId === 'tap' && k) { if (tab !== 'task') origin = tab; sheet(); taskDetail(k.id); }
});

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
let lastPomo = { id: '', n: 0 };
setInterval(() => {
  document.querySelectorAll('[data-tick]').forEach((n) => { const k = byId('tasks', n.dataset.tick); if (k) n.textContent = clock(el(k)); });
  document.querySelectorAll('[data-pomo]').forEach((n) => { const k = byId('tasks', n.dataset.pomo); if (k && S.timer?.pomo) n.textContent = pomoText(k); });
  if (S.timer?.run && S.timer.pomo) {
    const k = byId('tasks', S.timer.id), n = k ? Math.floor(el(k) / (S.timer.pomo * 60)) : 0;
    if (lastPomo.id !== S.timer.id) lastPomo = { id: S.timer.id, n }; else if (n > lastPomo.n) { lastPomo.n = n; toast('🍅 Focus block done. Take a short break, then resume.'); }
  }
}, 1000);
setInterval(() => { const key = today() + '|' + L.tzKey(); if (key !== lastKey) refresh(); else if (overSig() !== lastOver) { lastOver = overSig(); if (tab !== 'task') render(); } }, 20000);

/* ---------- boot ---------- */
initApp();
