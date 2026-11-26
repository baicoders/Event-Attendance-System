import json,os,shutil,subprocess,re,sys
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
expect.set_options(timeout=30000)
F=json.loads(Path(os.environ['CLASSROOM_MOBILE_FIXTURE']).read_text());base=F['base'];classes=F['classes'];scratch=Path(F['artifacts']);scratch.mkdir(parents=True,exist_ok=True)
def no_overflow(page):
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), '375px page overflow'
def navigation_fits(page):
 assert page.locator('nav[aria-label="Primary"]').last.evaluate("""nav=>{const links=[...nav.querySelectorAll('a')];return links.every((link,index)=>{const rect=link.getBoundingClientRect();return (!index||links[index-1].getBoundingClientRect().right<=rect.left+1)&&[...link.querySelectorAll('span')].every(span=>{const inner=span.getBoundingClientRect();return inner.left>=rect.left-1&&inner.right<=rect.right+1;});});}"""),'Zoomed navigation overlaps its neighboring links'
def context_for(browser,camera=False):
 context=browser.new_context(viewport={'width':375,'height':812},permissions=['camera'] if camera else []);name,value=F['cookie'].split('=',1);context.add_cookies([{'name':name,'value':value,'url':base,'httpOnly':True,'sameSite':'Lax'}]);return context
def button(page,name):return page.get_by_role('button',name=name,exact=True)
def card(page,size,index):return page.locator('[data-roster-student="'+classes[str(size)]['students'][index]['id']+'"]')
def begin(page,size,lost=False):
 page.goto(base+'/class/classes/'+classes[str(size)]['id']+'/start');expect(page.get_by_role('heading',name='Start attendance',exact=True)).to_be_visible();no_overflow(page)
 path=base+'/api/classroom/classes/'+classes[str(size)]['id']+'/sessions'
 def lose(route):route.fetch();route.abort()
 if lost:page.route(path,lose)
 button(page,'Start attendance').click()
 if lost:
  expect(page.get_by_role('heading',name='Saves awaiting confirmation')).to_be_visible();expect(page.get_by_role('alert')).to_contain_text('fetch');page.unroute(path,lose);page.reload()
 expect(page).to_have_url(__import__('re').compile('/class/sessions/'));expect(page.get_by_role('region',name='Manual attendance')).to_be_visible();button(page,'Roster').click();expect(page.get_by_label('Attendance filter')).to_be_visible();return page.url.split('?')[0]
def filtered_refresh_review(page):
 # Disable browser scroll anchoring so the application must preserve its own
 # viewport, including on browsers which do not provide native anchoring.
 with page.expect_response(lambda response:'/roster?' in response.url and 'q=N100_' in response.url and 'status=UNMARKED' in response.url):
  page.get_by_label('Search this session').fill('N100_');choose_attendance_filter(page, 'UNMARKED')
 expect(page.locator('[data-roster-student]')).to_have_count(100);page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
 page.evaluate("document.documentElement.style.overflowAnchor='none'");target=card(page,100,60);survivor=card(page,100,61)
 target.evaluate("el=>window.scrollTo(0,scrollY+el.getBoundingClientRect().top-120)");before=survivor.bounding_box()['y'];assert page.evaluate('scrollY')>1000
 session_id=page.url.split('?')[0].rsplit('/',1)[1];held=[];pattern=re.compile(re.escape(base+'/api/classroom/sessions/'+session_id+'/roster')+r'\?.*')
 def hold_roster(route):held.append((route,route.fetch()))
 page.route(pattern,hold_roster)
 target.get_by_role('button',name='Present — N100_060, Student',exact=True).click();confirmation=page.get_by_role('status').filter(has_text='Confirmed: Present — Student N100_060.');expect(confirmation).to_have_count(1)
 expect(target.locator('span').filter(has_text=re.compile('^Present$'))).to_have_count(1)
 for _ in range(250):
  if held:break
  page.wait_for_timeout(20)
 assert held,'The filtered roster was never refetched'
 page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');box=confirmation.bounding_box();account=page.get_by_role('button',name='Account menu for Mobile teacher').bounding_box();nav=page.get_by_role('navigation',name='Primary').last.bounding_box();visible=box['y']>=account['y']+account['height'] and box['y']+box['height']<=nav['y'] and box['x']>=0 and box['x']+box['width']<=375
 for route,response in held:route.fulfill(response=response)
 page.unroute(pattern,hold_roster)
 expect(target).to_have_count(0);expect(page.locator('[data-roster-student]')).to_have_count(99);page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');delta=abs(survivor.bounding_box()['y']-before)
 expect(page.get_by_label('Search this session')).to_have_value('N100_');expect(page.get_by_role('combobox',name='Attendance filter',exact=True)).to_contain_text('Unmarked');box_after=confirmation.bounding_box();visible_after=box_after['y']>=account['y']+account['height'] and box_after['y']+box_after['height']<=nav['y'];observed={'survivingRowShiftPx':round(delta,2),'confirmationVisibleDuringDelayedRead':visible,'confirmationVisibleAfterRemoval':visible_after};print('Filtered refresh review: '+json.dumps(observed),flush=True);assert delta<=3 and visible and visible_after,observed
 # A deliberate scroll during the delayed read must not be undone by restoration.
 held.clear();page.route(pattern,hold_roster);next_target=card(page,100,62);next_target.evaluate("el=>window.scrollTo(0,scrollY+el.getBoundingClientRect().top-120)");next_target.get_by_role('button',name='Present — N100_062, Student',exact=True).click();expect(page.get_by_role('status').filter(has_text='Confirmed: Present — Student N100_062.')).to_have_count(1)
 for _ in range(250):
  if held:break
  page.wait_for_timeout(20)
 assert held;start_scroll=page.evaluate('scrollY');page.mouse.wheel(0,400);page.wait_for_function('scrollY>='+str(start_scroll+390));page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');manual_scroll=page.evaluate('scrollY')
 for route,response in held:route.fulfill(response=response)
 page.unroute(pattern,hold_roster);expect(next_target).to_have_count(0);expect(page.locator('[data-roster-student]')).to_have_count(98);page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');assert abs(page.evaluate('scrollY')-manual_scroll)<=3,'The delayed refresh undid the teacher’s own scroll';print('PASS teacher-controlled scroll during delayed refresh',flush=True)
 no_overflow(page);choose_attendance_filter(page, '');page.get_by_label('Search this session').fill('');expect(page.locator('[data-roster-student]')).to_have_count(100)
def choose_attendance_filter(page, value):
 page.get_by_role('combobox',name='Attendance filter',exact=True).click()
 page.get_by_role('option',name={'':'All results','UNMARKED':'Unmarked','PRESENT':'Present','LATE':'Late','ABSENT':'Absent','EXCUSED':'Excused'}[value],exact=True).click()

with sync_playwright() as p:
 args=['--no-sandbox','--disable-dev-shm-usage','--renderer-process-limit=2'];chrome=shutil.which('google-chrome') or '/opt/google/chrome/chrome';browser=p.chromium.launch(executable_path=chrome,headless=True,args=args);context=context_for(browser);page=context.new_page()
 page.add_init_script("window.__attendanceClicks=[];document.addEventListener('click',event=>window.__attendanceClicks.push({text:event.target.textContent?.slice(0,100),tag:event.target.tagName,x:event.clientX,y:event.clientY}),true)");page.on('request',lambda request:(scratch/'write-requests.log').open('a').write(request.method+' '+request.url+' '+str(request.post_data)+'\n') if request.method in ['POST','PUT','PATCH'] else None)
 try:
  if os.environ.get('CLASSROOM_MOBILE_NAV_ONLY')=='true':
   page.goto(base+'/class');expect(page.get_by_role('heading',name='My Classes',exact=True)).to_be_visible();page.evaluate("document.documentElement.style.zoom='2'");navigation_fits(page);print('PASS zoom navigation');sys.exit(0)
  if os.environ.get('CLASSROOM_MOBILE_FILTER_REVIEW_ONLY')=='true':
   begin(page,100);filtered_refresh_review(page);print('PASS delayed filtered refresh and visible confirmation');sys.exit(0)
  meeting=begin(page,35,True);session_id=meeting.rsplit('/',1)[1]
  path=base+'/api/classroom/sessions/'+session_id+'/attendance/'+classes['35']['students'][0]['id']
  def lose_manual(route):route.fetch();route.fulfill(status=409,content_type='text/html',body='Unreadable acknowledgment')
  page.route(path,lose_manual);card(page,35,0).get_by_role('button',name='Present — N35_000, Student',exact=True).click();expect(page.get_by_role('heading',name='Saves awaiting confirmation')).to_be_visible();expect(card(page,35,0).locator('span').filter(has_text=re.compile('^Unmarked$'))).to_be_visible();expect(page.get_by_role('status').filter(has_text='Confirmed:')).to_have_count(0);expect(button(page,'Check or retry same save')).to_be_visible();page.unroute(path,lose_manual);page.reload();expect(page.get_by_role('heading',name='Saves awaiting confirmation')).to_have_count(0);expect(card(page,35,0).locator('span').filter(has_text=re.compile('^Present$'))).to_be_visible()
  card(page,35,1).get_by_role('button',name='Absent — N35_001, Student',exact=True).click();expect(card(page,35,1).locator('span').filter(has_text=re.compile('^Absent$'))).to_be_visible();card(page,35,2).get_by_role('button',name='Excused — N35_002, Student',exact=True).click();page.get_by_label('Excuse note (optional)',exact=True).fill('Excuse letter from guardian');button(page,'Save Excused').click();expect(card(page,35,2).locator('span').filter(has_text=re.compile('^Excused$'))).to_be_visible();expect(card(page,35,2).get_by_text('Excuse: Excuse letter from guardian')).to_be_visible()
  card(page,35,1).get_by_role('button',name='Late — N35_001, Student',exact=True).click();expect(button(page,'Save Late')).to_be_disabled();page.get_by_label('Reason for correction',exact=True).fill('Arrived after the grace period');button(page,'Save Late').click();expect(card(page,35,1).locator('span').filter(has_text=re.compile('^Late$'))).to_be_visible()
  page.get_by_label('Search this session',exact=True).fill('N35_003');expect(page.locator('[data-roster-student]')).to_have_count(1);card(page,35,3).get_by_role('button',name='Present — N35_003, Student',exact=True).click();expect(card(page,35,3).locator('span').filter(has_text=re.compile('^Present$'))).to_be_visible();expect(page.get_by_label('Search this session')).to_have_value('N35_003');page.get_by_label('Search this session').fill('');expect(page.locator('[data-roster-student]')).to_have_count(35)
  card(page,35,20).scroll_into_view_if_needed();before=page.evaluate('scrollY');card(page,35,20).get_by_role('button',name='Present — N35_020, Student',exact=True).click();expect(card(page,35,20).locator('span').filter(has_text=re.compile('^Present$'))).to_be_visible();assert page.evaluate('scrollY')>before-100,'mark reset scroll to top';no_overflow(page)
  retry_path=base+'/api/classroom/sessions/'+session_id+'/attendance/'+classes['35']['students'][21]['id'];row_commands=[]
  page.on('request',lambda request:row_commands.append(json.loads(request.post_data)['commandId']) if request.url==retry_path and request.method=='PUT' else None)
  def offline_row(route):route.fulfill(status=503,content_type='application/json',body=json.dumps({'success':False,'message':'Temporary connection failure'}))
  page.route(retry_path,offline_row);card(page,35,21).scroll_into_view_if_needed();card(page,35,21).get_by_role('button',name='Present — N35_021, Student',exact=True).click();expect(card(page,35,21).get_by_role('button',name='Check same save — N35_021, Student',exact=True)).to_be_visible();expect(card(page,35,21).get_by_role('button',name='Present — N35_021, Student',exact=True)).to_be_disabled();page.unroute(retry_path,offline_row);card(page,35,21).get_by_role('button',name='Check same save — N35_021, Student',exact=True).click();expect(card(page,35,21).locator('span').filter(has_text=re.compile('^Present$'))).to_be_visible();assert len(row_commands)==2 and row_commands[0]==row_commands[1],'Row recovery replaced the original command UUID'
  choose_attendance_filter(page, 'UNMARKED');expect(card(page,35,0)).to_have_count(0);card(page,35,22).scroll_into_view_if_needed();card(page,35,22).get_by_role('button',name='Present — N35_022, Student',exact=True).click();expect(card(page,35,22)).to_have_count(0);expect(page.get_by_role('combobox',name='Attendance filter',exact=True)).to_contain_text('Unmarked');assert page.evaluate('scrollY')>100,'filtered mark reset scroll';choose_attendance_filter(page, '')
  # Denied camera remains a real manual fallback, with no local server setup.
  page.add_init_script("Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:()=>Promise.reject(new DOMException('Denied','NotAllowedError'))})");page.reload();button(page,'Scan QR').click();button(page,'Open student QR camera').click();expect(page.get_by_role('alert').filter(has_text='Camera unavailable')).to_be_visible();button(page,'Use manual attendance').click();expect(page.get_by_role('region',name='Manual attendance')).to_be_visible();no_overflow(page)
  # Render actual student QRs and decode real fake-video frames through local WASM.
  render=browser.new_page(viewport={'width':720,'height':720});videos={}
  for key,qr in F['qr'].items():
   png=scratch/(key+'.png');video=scratch/(key+'.y4m');render.set_content('<body style="margin:0;background:white;display:flex;align-items:center;justify-content:center;height:720px">'+qr['svg']+'</body>');render.screenshot(path=str(png));subprocess.run(['ffmpeg','-loglevel','error','-y','-loop','1','-i',str(png),'-t','1','-r','5','-pix_fmt','yuv420p','-threads','1',str(video)],check=True,timeout=30);videos[key]=video
  render.close()
  for key,video in videos.items():
   camera_browser=p.chromium.launch(executable_path=chrome,headless=True,args=args+['--use-fake-device-for-media-stream','--use-file-for-fake-video-capture='+str(video.resolve())]);camera_context=context_for(camera_browser,True);camera_page=camera_context.new_page();decoder=[];external=[];camera_page.on('response',lambda response:decoder.append(response) if '/qr-decoder/' in response.url else None);camera_page.route('**/*',lambda route:route.continue_() if route.request.url.startswith(base) or route.request.url.startswith('data:') else (external.append(route.request.url),route.abort())[-1])
   held_decoder=[];decoder_state={'release':False};scan_requests=[]
   if key=='usn':
    def hold_decoder(route):
     if decoder_state['release']:route.continue_()
     else:held_decoder.append(route)
    camera_page.route('**/qr-decoder/**',hold_decoder)
    camera_page.on('request',lambda request:scan_requests.append(request.url) if '/api/classroom/' in request.url and request.method in ['POST','PUT','PATCH'] else None)
   camera_page.goto(meeting+'?manualView=ROSTER&q=N35_030');button(camera_page,'Scan QR').click()
   if key=='usn':
    with camera_page.expect_request('**/qr-decoder/**'):button(camera_page,'Open student QR camera').click()
    help_trigger=button(camera_page,'Help: Scan student QR cards');help_trigger.click();expect(camera_page.get_by_role('dialog')).to_be_visible();decoder_state['release']=True
    for route in held_decoder:route.continue_()
    camera_page.wait_for_timeout(1200);assert not scan_requests,'Scanner processed a card while its help was open'
    button(camera_page,'Back to my task').click();expect(help_trigger).to_be_focused()
   else:button(camera_page,'Open student QR camera').click()
   if key=='unknown':expect(camera_page.get_by_role('alert').filter(has_text='not recognized')).to_be_visible()
   elif key=='visitor':
    expect(camera_page.get_by_role('heading',name='Student outside this session')).to_be_visible();camera_page.get_by_label('Reason',exact=True).fill('Visiting the scheduled class');button(camera_page,'Confirm inclusion').click();expect(camera_page.get_by_role('status').filter(has_text='Confirmed:')).to_be_visible()
   else:
    expect(camera_page.get_by_role('status').filter(has_text='Confirmed:')).to_be_visible();button(camera_page,'Close camera').click();button(camera_page,'Open student QR camera').click();expect(camera_page.get_by_role('status').filter(has_text='Already marked')).to_be_visible()
   assert decoder and all(response.ok for response in decoder),'local decoder unavailable';assert not external,'camera used external network';no_overflow(camera_page);camera_browser.close()
  page.reload();button(page,'Review and finalize attendance').click();button(page,'Finalize and mark remaining Absent').click();expect(page.get_by_role('region',name='Session summary')).to_contain_text('Finalized');card(page,35,5).get_by_role('button',name='Excused — N35_005, Student',exact=True).click();page.get_by_label('Reason for correction',exact=True).fill('Accepted excuse after class');button(page,'Save Excused').click();expect(card(page,35,5).locator('span').filter(has_text=re.compile('^Excused$'))).to_be_visible();page.reload();expect(card(page,35,5).locator('span').filter(has_text=re.compile('^Excused$'))).to_be_visible();no_overflow(page)
  for size in [100,101,220]:
   begin(page,size);expect(page.locator('[data-roster-student]')).to_have_count(100)
   if size==100:filtered_refresh_review(page)
   if size>100:
    button(page,'Next').click();expect(page.get_by_text('Page 2 of '+str((size+99)//100)+' · '+str(size)+' students',exact=True)).to_be_visible();expect(page.locator('[data-roster-student]')).to_have_count(min(size-100,100))
    if size==220:
     button(page,'Next').click();expect(page.locator('[data-roster-student]')).to_have_count(20);expect(page).to_have_url(re.compile('page=3'));page.reload();expect(page.get_by_text('Page 3 of 3 · 220 students',exact=True)).to_be_visible();expect(page.locator('[data-roster-student]')).to_have_count(20)
   page.get_by_label('Search this session').fill('N'+str(size)+'_'+str(size-1).zfill(3));expect(page.locator('[data-roster-student]')).to_have_count(1);last=card(page,size,size-1);last.get_by_role('button',name='Present — N'+str(size)+'_'+str(size-1).zfill(3)+', Student',exact=True).click();expect(last.locator('span').filter(has_text=re.compile('^Present$'))).to_be_visible();no_overflow(page);expect(page).to_have_url(re.compile('q='));page.reload();expect(page.get_by_label('Search this session')).to_have_value('N'+str(size)+'_'+str(size-1).zfill(3));expect(page.locator('[data-roster-student]')).to_have_count(1);page.get_by_text('Session options',exact=False).click();page.get_by_role('menuitem',name='Cancel session',exact=True).click();page.get_by_label('Reason',exact=True).fill('Meeting used for training');button(page,'Cancel this session').last.click();expect(page.get_by_role('region',name='Session summary')).to_contain_text('Canceled');no_overflow(page)
  # Keyboard and zoom remain usable at the mobile viewport.
  page.goto(meeting);page.get_by_label('Search this session').focus();page.keyboard.press('Tab');expect(page.get_by_label('Attendance filter')).to_be_focused();page.evaluate("document.documentElement.style.zoom='2'");no_overflow(page);navigation_fits(page);page.screenshot(path=str(scratch/'attendance-375.png'),full_page=True)
 except Exception:
  page.screenshot(path=str(scratch/'attendance-failed.png'),full_page=True)
  (scratch/'clicks.json').write_text(json.dumps(page.evaluate('window.__attendanceClicks')))
  raise
 finally:
  browser.close()
print('PASS375px real Start lost-ack reload, manual malformed409 recovery,35/100/101/220 rosters, preserved scroll/search/filter, all statuses and optional notes/reasons, local-WASM USN/LRN/internal-ID scanning, duplicate/unknown/ineligible scans, camera-denied fallback, finalization/cancellation/finalized correction, keyboard labels and200% zoom.')
