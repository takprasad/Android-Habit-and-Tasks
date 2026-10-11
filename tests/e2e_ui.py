from playwright.sync_api import sync_playwright
import json, sys
errs=[]
def S(page, expr): return page.evaluate(f"(() => {{ const S = window.__ht.S, L = window.__ht.L; return {expr}; }})()")
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2); page=ctx.new_page()
    page.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
    page.on('console', lambda m: errs.append('CONSOLE '+m.text) if m.type=='error' and '428' not in m.text else None)
    page.on('dialog', lambda d: d.accept())
    import re
    page.goto('http://localhost:8765/index.html?e2e'); page.wait_for_selector('#tabs button')
    def tab(n): page.click(f'#tabs button[data-id={n}]')
    # ---- quick add
    tab('tasks'); page.fill('#qa','Pay rent every month on 1st #home #bills ~30m !high'); page.press('#qa','Enter')
    t=S(page,"S.tasks[0]"); print('quick add ->', json.dumps({k:t[k] for k in ('title','pri','due','tags','est','rec')}))
    assert t['title']=='Pay rent' and t['pri']=='High' and t['tags']==['home','bills'] and t['est']==30 and t['rec']['u']=='month', t
    assert page.locator('.card .row', has_text='Pay rent').count()>=1
    assert '🔁' in page.inner_text('#app')
    page.fill('#qa','Call mom tomorrow 6pm !low #family'); page.click('[data-a=qa]')
    assert S(page,"S.tasks.length")==2
    page.screenshot(path='/tmp/shot_tasks.png')
    # tag filter + sort
    page.click('button.chip:has-text("#family")'); assert page.locator('#app .card .row .grow', has_text='Call mom').count()==1 and page.locator('#app .card .row .grow', has_text='Pay rent').count()==0
    page.click('button.chip.on:has-text("#family")'); assert page.locator('#app .card .row .grow', has_text='Pay rent').count()==1, 'tapping the active tag clears the filter'
    page.select_option('select[name=sort]','pri')
    # FAB hides while a sheet is open; quick-date chips fill the due date
    page.click('.fab-btn'); assert not page.is_visible('.fab-btn'); page.click('[data-a=qd][data-id="1"]'); assert page.input_value('#sheet input[name=due]')==S(page,"L.add(L.today(),1)")
    page.click('[data-a=qd][data-id=x]'); assert page.input_value('#sheet input[name=due]')==''; page.click('[data-a=x]'); assert page.is_visible('.fab-btn')
    # Today groups overdue tasks separately
    S(page,"(S.tasks.push({id:L.uid(),title:'Old one',pri:'Low',cat:'Work',due:L.add(L.today(),-3),time:null,status:'Not Started',start:L.today(),mp:0,fired:0,tags:[],sub:[],est:0,ms:{mode:'once',every:5,after:'reset',reward:'',url:''}}), null)")
    tab('today'); tx=page.inner_text('#app').lower(); assert 'overdue · 1' in tx
    assert page.locator('.tile').count()==2 and 'coins earned' in tx and 'tasks pending' in tx and page.locator('.hero').count()==0 and 'up next' not in tx
    assert page.locator('.tile >> nth=1').inner_text().split('\n')[1].strip().isdigit()
    ct=page.locator('.tile >> nth=0').inner_text().lower(); wk=S(page,"L.weekReview(S,0).earned"); assert 'this week' in ct and str(wk) in ct.split('\n')[1], (ct, wk)
    S(page,"(S.audit.push({type:'coins_earned',id:'x',p:{earned:7,coins:1},at:Date.now()-20*864e5}), S.earned+=7, null)"); tab('rewards'); tab('today')
    assert page.locator('.tile >> nth=0').inner_text().split('\n')[1].strip()==str(wk), 'older coins are not counted in the weekly card'
    S(page,"(S.tasks.pop(), null)")
    assert page.locator('.ringrow').count()==0 and "let's get going" not in tx and page.locator('#app svg circle').count()==0, 'progress ring card removed'
    # ---- fixed frames: only the list scrolls, headers stay put, scroll position survives a re-render
    S(page,"(Array.from({length:30},(_,i)=>S.tasks.push({id:L.uid(),title:'Bulk '+i,pri:'Low',cat:'Work',due:L.add(L.today(),2+i),time:null,status:'Not Started',start:L.today(),mp:0,fired:0,tags:[],sub:[],est:0,ms:{mode:'once',every:5,after:'reset',reward:'',url:''}})), Array.from({length:14},(_,i)=>S.habits.push({id:L.uid(),name:'BulkH '+i,cat:'Health',type:'daily',n:1,every:2,days:[],start:L.today(),multi:false,ms:{kind:'streak',target:30,policy:'reset',reward:'',url:''},prog:0,best:0,completed:0,resets:0,attempts:[],evals:[],attemptStart:L.today(),evalFrom:L.today(),archived:false,paused:false,ask:null})), null)")
    def frame(name, pre=None):
        tab(name); 
        if pre: pre()
        page.wait_for_timeout(150)
        assert page.evaluate("document.scrollingElement.scrollHeight <= window.innerHeight + 1"), name+': the page itself must not scroll'
        assert page.locator('#app.fixed').count()==1 and page.locator('.hud').count()==1 and page.inner_text('.hud').startswith('Lv'), name+': frame + level/coin pill'
        sb=page.locator('#app .scrollbox').first; assert sb.evaluate("e=>e.scrollHeight>e.clientHeight+40"), name+': list should be scrollable'
        y0=page.locator('#app h1').first.bounding_box()['y']; b0=page.locator('#tabs').bounding_box()['y']; sb.evaluate("e=>{e.scrollTop=500}"); page.wait_for_timeout(120)
        assert sb.evaluate("e=>e.scrollTop")>150, name+': list scrolled'; assert page.locator('#app h1').first.bounding_box()['y']==y0 and page.locator('#tabs').bounding_box()['y']==b0, name+': header and tab bar stay put'
        return sb
    frame('today'); frame('habits')
    sb=frame('tasks'); page.click('#fil label.chip:has-text("All")'); assert page.locator('#app .scrollbox').first.evaluate("e=>e.scrollTop")>=300, 'scroll position kept across a re-render'; page.click('#fil label.chip:has-text("Open")')
    frame('rewards', lambda: page.click('#rseg label:has-text("Badges")')); page.click('#rseg label:has-text("Unlocked")')
    S(page,"(S.tasks=S.tasks.filter(k=>!k.title.startsWith('Bulk ')), S.habits=S.habits.filter(h=>!h.name.startsWith('BulkH')), null)")
    # level + coins pill on the pages that scroll normally too
    tab('settings'); assert page.locator('.hud').count()==1 and 'Lv' in page.inner_text('.hud') and page.locator('#app.fixed').count()==0
    page.click('[data-a=tab][data-id=stats]'); assert page.locator('.hud').count()==1; tab('tasks')
    page.click('#tvseg label:has-text("Calendar")'); assert page.locator('.hud').count()==1 and page.locator('#app .scrollbox .cal').count()==1; page.click('#tvseg label:has-text("List")')
    page.click('#app .card .grow:has-text("Call mom")'); page.wait_for_selector('#sn'); assert page.locator('.hud').count()==1 and page.locator('#app.fixed').count()==0; page.click('.hud'); assert 'how levels work' in page.inner_text('#sheet').lower(); page.click('[data-a=x]'); page.click('button[data-a=back]')
    tab('tasks')

    # ---- task detail: steps
    page.click('#app .card .grow:has-text("Pay rent")'); page.wait_for_selector('#sn')
    for s_ in ['Open bank app','Transfer amount']:
        page.fill('#sn', s_); page.press('#sn','Enter')
    assert S(page,"S.tasks[0].sub.length")==2
    page.click('[data-a=sub] >> nth=0'); assert S(page,"S.tasks[0].sub[0].d")==1
    assert 'steps · 1/2' in page.inner_text('#app').lower()
    page.screenshot(path='/tmp/shot_detail.png', full_page=True)
    # ---- complete recurring + undo
    page.click('button[data-a=tc]'); 
    assert S(page,"S.tasks.length")==3, S(page,"S.tasks.length"); nx=S(page,"S.tasks[2]"); print('next instance due', nx['due'], 'subs reset', [x['d'] for x in nx['sub']])
    assert 'Undo' in page.inner_text('#toast'); page.click('#undo')
    assert S(page,"S.tasks.length")==2 and S(page,"S.tasks[0].status")!='Completed' and S(page,"S.coins")==0
    page.click('button[data-a=tc]'); assert S(page,"S.tasks.length")==3 and S(page,"S.coins")>0
    # ---- duplicate + delete + undo
    page.click('button[data-a=back]'); 
    page.click('#app .card .grow:has-text("Call mom")'); page.click('[data-a=dup]'); assert S(page,"S.tasks.length")==4
    page.click('[data-a=dt]'); assert S(page,"S.tasks.length")==3; page.click('#undo'); assert S(page,"S.tasks.length")==4
    # ---- edit task with weekly repeat
    page.click('#app .card .grow:has-text("Call mom")'); page.click('[data-a=et]')
    page.fill('#sheet input[name=due]', S(page,"L.add(L.today(),1)")); page.click('#sheet label:has-text("Weeks")'); assert page.is_visible('#rw')
    page.click('#sheet input[name=rday][value="0"] >> xpath=..'); page.click('#sheet input[name=rday][value="3"] >> xpath=..'); page.fill('#sheet input[name=tags]','Family, #kids, bad tag!'); page.fill('#sheet input[name=est]','45')
    page.click('[data-a=st]'); k=S(page,"S.tasks.find(x=>x.title==='Call mom')"); print('edited', k['rec'], k['tags'], k['est']); assert k['rec']['u']=='week' and k['rec']['days']==[0,3] and 'kids' in k['tags'] and k['est']==45
    # repeat without due is rejected
    page.click('[data-a=et]'); page.fill('#sheet input[name=due]',''); page.click('[data-a=st]'); assert 'need a due date' in page.inner_text('#toast'); page.click('[data-a=x]')
    # ---- pomodoro
    page.click('[data-a=startp]'); page.wait_for_selector('[data-pomo]'); print('pomo:', page.inner_text('[data-pomo]')); assert S(page,"Object.values(S.timers)[0].pomo")==25
    page.wait_for_timeout(800); page.click('[data-a=stop]'); page.click('[data-a=sstop]')
    c0=S(page,"S.coins"); e0=S(page,"S.earned"); page.click('[data-a=lt]'); page.fill('#sheet input[name=mm]','30'); page.click('[data-a=slt]')
    assert S(page,"S.coins")==c0+1 and S(page,"S.earned")==e0+1, 'a 30 minute session earns 1 coin at 2 per hour'
    c1=S(page,"S.coins"); page.click('[data-a=lt]'); page.fill('#sheet input[name=mm]','3'); page.click('[data-a=slt]'); assert S(page,"S.coins")==c1, 'under 5 minutes earns nothing'
    page.click('button[data-a=back]')
    # ---- several timers running at the same time
    page.click('#app .card .grow:has-text("Call mom")'); page.wait_for_timeout(700); page.click('[data-a=start]'); assert S(page,"Object.keys(S.timers).length")==1
    page.click('button[data-a=back]'); page.click('#app .card .grow:has-text("Pay rent")'); page.wait_for_timeout(700); page.click('[data-a=start]')
    assert S(page,"Object.keys(S.timers).length")==2 and S(page,"L.runningCount(S)")==2, 'a second timer does not stop the first'
    page.click('button[data-a=back]'); assert page.locator('#app .card [data-tick]').count()==2, 'both running tasks show a live timer in the list'
    page.wait_for_timeout(2300); ticks=page.evaluate("[...document.querySelectorAll('#app .card [data-tick]')].map(n=>n.textContent)"); assert len(ticks)==2 and all(t!='00:00:00' for t in ticks), ticks
    tab('today'); assert page.locator('#app .card [data-tick]').count()==2, 'Today list shows both too'; tab('tasks')
    page.click('#app .card .grow:has-text("Pay rent")'); page.wait_for_timeout(700); n0=S(page,"S.sessions.length"); page.click('[data-a=stop]'); page.click('[data-a=sstop]')
    assert S(page,"Object.keys(S.timers).length")==1 and S(page,"S.sessions.length")==n0+1 and S(page,"S.tasks.find(k=>k.id===Object.keys(S.timers)[0]).title")=='Call mom', 'stopping one timer leaves the other running'
    page.wait_for_timeout(700); page.click('button[data-a=back]'); page.click('#app .card .grow:has-text("Call mom")'); page.wait_for_timeout(700); page.click('[data-a=pause]'); assert S(page,"Object.values(S.timers)[0].run")==False; page.wait_for_timeout(700); page.click('[data-a=resume]'); page.wait_for_timeout(700)
    page.click('[data-a=stop]'); page.click('[data-a=sstop]'); assert S(page,"Object.keys(S.timers).length")==0; page.click('button[data-a=back]')
    # ---- calendar
    page.click('#tvseg label:has-text("Calendar")'); page.wait_for_selector('.cal'); page.screenshot(path='/tmp/shot_cal.png')
    page.click('.cal-d.today'); assert page.locator('[data-a=cadd]').count()==1
    page.click('[data-a=cm][data-id="1"]'); page.click('[data-a=cm][data-id="-1"]')
    tm=S(page,"L.add(L.today(),1)"); page.click(f'.cal-d[data-id="{tm}"]'); assert 'Call mom' in page.inner_text('#app')
    page.click('[data-a=cadd]'); assert page.input_value('#sheet input[name=due]')==tm; page.click('[data-a=x]')
    page.click('#tvseg label:has-text("List")')
    # ---- habits: create, check in, notes, heat
    tab('habits'); page.click('.fab-btn'); page.fill('#sheet input[name=name]','Read'); page.click('#sheet label:has-text("Daily")'); page.click('[data-a=sh]')
    page.click('[data-a=ci]'); assert S(page,"S.checkins.length")==1
    tab('today'); page.click('.habit-strip-name'); page.wait_for_selector('.heat'); page.click('#sheet label.chip:has-text("🙂")'); page.fill('#sheet input[name=hnote]','Chapter 3'); page.click('[data-a=hnote]')
    c=S(page,"S.checkins[0]"); print('note', c.get('mood'), c.get('note')); assert c['note']=='Chapter 3' and c['mood']=='🙂'
    page.screenshot(path='/tmp/shot_habit.png'); page.click('[data-a=x]')
    # ---- rewards: level, freeze, badges, wallet
    S(page,"(S.coins = 60, null)"); tab('rewards'); assert 'Streak freezes' in page.inner_text('#app')
    page.click('[data-a=bfz]'); assert S(page,"S.freezes")==1 and S(page,"S.coins")==40
    page.click('#rseg label:has-text("Badges")'); assert page.locator('.badge').count()>=36 and page.locator('.badge:not(.lock)').count()>=2 and 'earned' in page.inner_text('#app') and '/ ' in page.inner_text('.badge.lock >> nth=0'); page.screenshot(path='/tmp/shot_badges.png')
    page.click('[data-a=wal]'); txt=page.inner_text('#sheet'); print('wallet:', txt.replace('\n',' | ')[:200]); assert 'Streak freeze' in txt and 'Pay rent' in txt; page.click('[data-a=x]')
    page.click('#rseg label:has-text("Unlocked")'); assert 'level 3' not in page.inner_text('#app').lower() and 'earned in total' not in page.inner_text('#app').lower(), 'level bar moved off Rewards'
    tab('today'); lv=page.locator('.lvlcard'); assert lv.count()==1 and 'level' in lv.inner_text().lower() and lv.locator('.bar').count()==1
    lv.click(); assert 'how levels work' in page.inner_text('#sheet').lower() and '5 × N × (N − 1)' in page.inner_text('#sheet'); page.click('[data-a=x]')
    # ---- stats
    tab('settings'); st=page.inner_text('#app').lower(); assert 'level info' not in st and 'per hour' in st and 'backup & restore' in st and 'back up now' in st and 'restore from a backup file' in st and 'export data (json)' not in st
    page.fill('#ncat','Fitness'); page.click('[data-a=addcat]'); assert S(page,"S.cats")==['Fitness'] and page.locator('.catchip', has_text='Fitness').count()==1
    page.fill('#ncat','fitness'); page.click('[data-a=addcat]'); assert S(page,"S.cats")==['Fitness'], 'duplicate ignoring case'
    page.click('[data-a=delcat][data-id=Fitness]'); assert S(page,"S.cats")==[]; page.fill('#ncat','Fitness'); page.press('#ncat','Enter'); assert S(page,"S.cats")==['Fitness']
    tab('tasks'); page.click('.fab-btn'); assert page.locator('#sheet select[name=cat] option', has_text='Fitness').count()==1; page.fill('#sheet input[name=title]','Cat task'); page.fill('#sheet input[name=newcat]','Side project'); page.click('[data-a=st]')
    assert S(page,"S.tasks.find(k=>k.title==='Cat task').cat")=='Side project' and 'Side project' in S(page,"S.cats")
    tab('habits'); page.click('.fab-btn'); assert page.locator('#sheet label.chip', has_text='Side project').count()==1; page.fill('#sheet input[name=name]','Cat habit'); page.click('#sheet label.chip:has-text("Fitness")'); page.click('#sheet label:has-text("Daily")'); page.click('[data-a=sh]')
    assert S(page,"S.habits.find(h=>h.name==='Cat habit').cat")=='Fitness'
    tab('settings'); assert 'still used' not in page.inner_text('#app'); page.click('[data-a=delcat][data-id=Fitness]'); assert 'Fitness' in S(page,"S.cats") and 'still used' in page.inner_text('#toast')
    S(page,"(S.cats.push('Temp'), null)"); tab('rewards'); tab('settings'); assert page.locator('.catchip', has_text='Temp').count()==1; page.click('[data-a=delcat][data-id=Temp]'); assert 'Temp' not in S(page,"S.cats")
    page.fill('input[name=sc]','3'); page.press('input[name=sc]','Tab'); assert S(page,"S.settings.coinsPerHour")==3; page.fill('input[name=sc]','2'); page.press('input[name=sc]','Tab')
    # ---- manual backup (share sheet / download) and restore (file picker)
    assert 'last backup sent: never' in page.inner_text('#app').lower()
    with page.expect_download() as dl: page.click('[data-a=bk]')
    d=dl.value; assert re.match(r'^habit-task-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$', d.suggested_filename), d.suggested_filename
    body=open(d.path(), encoding='utf-8').read(); J=json.loads(body); assert J['coins']==S(page,"S.coins") and len(J['tasks'])==S(page,"S.tasks.length") and 'shared' in page.inner_text('#toast').lower()
    assert 'never' not in page.inner_text('#app').lower().split('last backup sent:')[1][:20], 'last backup time is shown'
    assert page.evaluate("window.__ht.store.kvGet('lastBackup')") is not None
    S(page,"(S.coins=777, null)"); page.set_input_files('#imp', files=[{'name':'b.json','mimeType':'application/json','buffer':body.encode()}]); page.wait_for_function("window.__ht.S.coins===%d" % J['coins'], timeout=8000)
    assert 'Data restored' in page.inner_text('#toast'), 'restore offers undo'; page.click('#undo'); assert S(page,"S.coins")==777; tab('settings'); page.set_input_files('#imp', files=[{'name':'b.json','mimeType':'application/json','buffer':body.encode()}]); page.wait_for_function("window.__ht.S.coins===%d" % J['coins'], timeout=8000)
    tab('settings'); page.set_input_files('#imp', files=[{'name':'bad.json','mimeType':'application/json','buffer':b'{nope'}]); page.wait_for_timeout(300); assert 'Invalid file' in page.inner_text('#toast') and S(page,"S.coins")==J['coins']
    tab('settings')
    page.click('[data-a=tab][data-id=stats]'); page.wait_for_selector('.heat'); page.screenshot(path='/tmp/shot_stats.png', full_page=True)
    page.click('#mseg label:has-text("Tasks")'); assert 'estimates vs actual' in page.inner_text('#app').lower()
    page.click('#mseg label:has-text("Weekly review")'); assert 'this week' in page.inner_text('#app'); page.screenshot(path='/tmp/shot_week.png', full_page=True)
    page.click('[data-a=wk][data-id="-1"]'); assert 'this week' not in page.inner_text('#app'); page.click('[data-a=wk][data-id="1"]')
    # ---- persistence / reload round trip of new fields
    page.evaluate("window.__ht.store.flush()"); page.reload(); page.wait_for_selector('#tabs button')
    assert S(page,"S.tasks.filter(k=>k.rec).length")>=2 and S(page,"S.freezes")==1 and S(page,"S.checkins[0].note")=='Chapter 3'
    # ---- dark mode screenshot of tasks
    page.emulate_media(color_scheme='dark'); tab('tasks'); page.screenshot(path='/tmp/shot_dark.png')
    b.close()
print('ERRORS:', errs if errs else 'none')
