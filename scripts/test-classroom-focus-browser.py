"""Focused attendance exercises the production API with an isolated fixture."""
import json,os,shutil,re,sys
from contextlib import suppress
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
expect.set_options(timeout=30000)
F=json.loads(Path(os.environ['CLASSROOM_MOBILE_FIXTURE']).read_text());base=F['base'];classes=F['classes'];scratch=Path(F['artifacts'])
def button(page,name):return page.get_by_role('button',name=name,exact=True)
def current(page):return page.locator('[data-focused-student]')
def fits(page):
 if not page.evaluate('document.documentElement.scrollWidth<=innerWidth'):
  print(json.dumps(page.evaluate("""()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1&&getComputedStyle(el).position!=='absolute').slice(-15).map(el=>({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right}))})""")),flush=True)
  raise AssertionError('Horizontal overflow')
def choose(page,status):current(page).get_by_role('button',name=re.compile('^'+status+' —')).click()
def begin(page,size):
 page.goto(base+'/class/classes/'+classes[str(size)]['id']+'/start');button(page,'Start attendance').click();expect(page).to_have_url(re.compile('/class/sessions/'));expect(current(page)).to_have_count(1);return page.url.split('?')[0]
def request(page,path,body,method='POST'):
 return page.evaluate("""async ([path,body,method])=>{const response=await fetch(path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()}}""",[path,body,method])
def choose_attendance_filter(page, value):
 page.get_by_role('combobox',name='Attendance filter',exact=True).click()
 page.get_by_role('option',name={'':'All results','UNMARKED':'Unmarked','PRESENT':'Present','LATE':'Late','ABSENT':'Absent','EXCUSED':'Excused'}[value],exact=True).click()

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('google-chrome') or '/opt/google/chrome/chrome',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--renderer-process-limit=2'])
 context=browser.new_context(viewport={'width':375,'height':812});name,value=F['cookie'].split('=',1);context.add_cookies([{'name':name,'value':value,'url':base,'httpOnly':True,'sameSite':'Lax'}]);page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 try:
  meeting=begin(page,35);sid=meeting.rsplit('/',1)[1];first_id=classes['35']['students'][0]['id'];path=base+'/api/classroom/sessions/'+sid+'/attendance/'+first_id;held=[]
  def delay(route):held.append((route,route.fetch()))
  page.get_by_label('Find an unmarked student').focus();page.keyboard.press('p');expect(current(page)).to_have_attribute('data-focused-student',first_id);page.get_by_label('Find an unmarked student').clear()
  page.route(path,delay);current(page).get_by_role('group',name='Attendance marks').focus();page.keyboard.down('p');page.keyboard.down('p');page.keyboard.up('p');expect(current(page)).to_have_attribute('data-focused-student',first_id);expect(current(page).get_by_role('button',name=re.compile('^Present —'))).to_be_disabled()
  for _ in range(200):
   if held:break
   page.wait_for_timeout(10)
  assert held;held[0][0].fulfill(response=held[0][1]);page.unroute(path,delay);expect(current(page)).to_have_attribute('data-focused-student',classes['35']['students'][1]['id']);expect(page.get_by_role('status',name='Attendance save status')).to_contain_text('Student N35_000');assert len(held)==1;fits(page)
  # Review uses the existing reasoned correction sheets with authoritative revision.
  button(page,'Review mark').click();expect(page.get_by_role('heading',name='Review last mark')).to_be_visible();button(page,'Late').click();page.get_by_label('Reason for correction',exact=True).fill('Arrived after the grace period');button(page,'Save Late').click();expect(page.get_by_role('status',name='Attendance save status')).to_contain_text('Late')
  current(page).get_by_role('group',name='Attendance marks').focus();page.keyboard.press('a');expect(current(page)).to_have_attribute('data-focused-student',classes['35']['students'][2]['id']);choose(page,'Late');expect(current(page)).to_have_attribute('data-focused-student',classes['35']['students'][3]['id']);current(page).get_by_role('group',name='Attendance marks').focus();page.keyboard.press('e');page.get_by_label('Excuse note (optional)',exact=True).fill('Approved letter');button(page,'Save Excused').click();expect(current(page)).to_have_attribute('data-focused-student',classes['35']['students'][4]['id'])
  # Committed response lost, reload: receipt settles the original command key.
  lost_id=classes['35']['students'][4]['id'];lost_path=base+'/api/classroom/sessions/'+sid+'/attendance/'+lost_id;keys=[]
  page.on('request',lambda req:keys.append(json.loads(req.post_data)['commandId']) if req.url==lost_path and req.method=='PUT' else None)
  def lost(route):route.fetch();route.abort()
  page.route(lost_path,lost);choose(page,'Present');expect(button(page,'Check or retry same save')).to_be_visible();expect(current(page)).to_have_attribute('data-focused-student',lost_id);page.unroute(lost_path,lost)
  recovery_reads=[]
  def hold_recovery(route):recovery_reads.append((route,route.fetch()))
  receipt_pattern=re.compile(re.escape(base+'/api/classroom/commands/')+r'.*')
  identity_pattern=re.compile(re.escape(base+'/api/classroom/sessions/'+sid+'/roster')+r'\?q='+re.escape(lost_id)+r'&.*')
  page.route(receipt_pattern,hold_recovery);page.route(identity_pattern,hold_recovery);page.reload()
  for _ in range(200):
   if len(recovery_reads)>=2:break
   page.wait_for_timeout(10)
  assert len(recovery_reads)>=2;page.wait_for_timeout(200)
  if os.environ.get('CLASSROOM_FOCUS_EXCLUSION_ONLY')!='true':expect(page.locator('[data-focused-student]:not([data-focused-student="'+lost_id+'"])')).to_have_count(0)
  for route,response in recovery_reads:route.fulfill(response=response)
  page.unroute(receipt_pattern,hold_recovery);page.unroute(identity_pattern,hold_recovery);expect(current(page)).to_have_attribute('data-focused-student',classes['35']['students'][5]['id']);expect(page.get_by_role('heading',name='Saves awaiting confirmation')).to_have_count(0);assert len(keys)==1
  # Malformed acknowledgement is uncertain until receipt lookup, no new key.
  bad_id=classes['35']['students'][5]['id'];bad_path=base+'/api/classroom/sessions/'+sid+'/attendance/'+bad_id
  def malformed(route):route.fetch();route.fulfill(status=200,content_type='application/json',body=json.dumps({'success':True,'data':{'data':{}}}))
  page.route(bad_path,malformed);choose(page,'Present');expect(button(page,'Check or retry same save')).to_be_visible();expect(current(page)).to_have_attribute('data-focused-student',bad_id);page.unroute(bad_path,malformed);button(page,'Check or retry same save').click();expect(current(page)).to_have_attribute('data-focused-student',classes['35']['students'][6]['id'])
  # Confirmed save survives a failed refresh and is not offered for retry.
  roster_pattern=re.compile(re.escape(base+'/api/classroom/sessions/'+sid+'/roster')+r'\?.*')
  def fail_read(route):route.fulfill(status=503,content_type='application/json',body=json.dumps({'success':False,'message':'Read unavailable'}))
  page.route(roster_pattern,fail_read);choose(page,'Present');expect(page.get_by_role('status',name='Attendance save status')).to_contain_text('Confirmed: Present');expect(page.get_by_role('heading',name='Saves awaiting confirmation')).to_have_count(0);expect(page.get_by_role('alert').filter(has_text='Confirmed saves remain saved')).to_be_visible();page.unroute(roster_pattern,fail_read);button(page,'Refresh roster').click();expect(current(page)).to_have_attribute('data-focused-student',classes['35']['students'][7]['id'])
  # Concurrent marking keeps another device's authoritative result.
  external=classes['35']['students'][7]['id'];r=request(page,'/api/classroom/sessions/'+sid+'/attendance/'+external,{'commandId':page.evaluate('crypto.randomUUID()'),'sessionId':sid,'studentId':external,'status':'LATE','expectedRevision':0},'PUT');assert r['status']==200
  choose(page,'Present');expect(current(page)).to_have_attribute('data-focused-student',classes['35']['students'][8]['id']);assert page.request.get(base+'/api/classroom/sessions/'+sid+'/roster?q='+external,headers={'cookie':F['cookie']}).json()['data']['items'][0]['attendance']['status']=='LATE'
  # Concurrent exclusion reconciles the member before offering a new decision.
  excluded=classes['35']['students'][8]['id'];summary=page.request.get(base+'/api/classroom/sessions/'+sid,headers={'cookie':F['cookie']}).json()['data'];r=request(page,'/api/classroom/sessions/'+sid+'/roster-adjustments',{'commandId':page.evaluate('crypto.randomUUID()'),'sessionId':sid,'studentId':excluded,'scope':'SESSION','action':'EXCLUDE','expectedSnapshotRevision':summary['snapshotRevision'],'reason':'Concurrent enrollment correction'});assert r['status']==200,r
  choose(page,'Present');expect(current(page)).to_have_attribute('data-focused-student',classes['35']['students'][9]['id'])
  page.get_by_label('Find an unmarked student').fill('no-such-name');expect(page.get_by_text('No unmarked search matches',exact=True)).to_be_visible();button(page,'Clear search').click();expect(current(page)).to_have_count(1)
  # Preserve roster preferences across Focus and reload.
  button(page,'Roster').click();choose_attendance_filter(page, 'ABSENT');expect(page.locator('[data-roster-student]')).to_have_count(1);page.get_by_role('group',name=re.compile('Attendance marks for')).focus();page.keyboard.press('l');expect(page.get_by_label('Reason for correction',exact=True)).to_be_visible();page.keyboard.press('Escape');expect(page.get_by_role('dialog')).to_have_count(0);button(page,'Focus on unmarked').click();expect(current(page)).to_have_count(1);page.reload();expect(current(page)).to_have_count(1);button(page,'Roster').click();expect(page.get_by_role('combobox',name='Attendance filter',exact=True)).to_contain_text('Absent');button(page,'Focus on unmarked').click()
  # Camera mode is gated while saves are uncertain; switching modes retains session.
  button(page,'Scan QR').click();button(page,'Use manual attendance').click();expect(current(page)).to_have_count(1)
  for width in [375,768,1440,1920]:
   page.set_viewport_size({'width':width,'height':1000});fits(page);page.screenshot(path=str(scratch/('focus-'+str(width)+'.png')),full_page=True)
  page.set_viewport_size({'width':375,'height':812});page.evaluate("document.documentElement.style.zoom='2'");fits(page);page.evaluate("document.documentElement.style.zoom='1'");page.emulate_media(reduced_motion='reduce');page.get_by_label('Find an unmarked student').focus();page.keyboard.press('Tab');assert page.evaluate('document.activeElement.tagName') in ['BUTTON','INPUT'];fits(page)
  # Each fresh boundary class is completed through actual UI decisions; no offset skipping.
  for size in ([100] if os.environ.get('CLASSROOM_FOCUS_QUICK')=='true' else [100,101,220]):
   begin(page,size);seen=[]
   for index in range(size):
    expected=classes[str(size)]['students'][index]['id'];expect(current(page)).to_have_attribute('data-focused-student',expected);seen.append(expected);choose(page,'Present')
    if index+1<size:expect(current(page)).to_have_attribute('data-focused-student',classes[str(size)]['students'][index+1]['id'])
   expect(page.get_by_text('Everyone has been marked',exact=True)).to_be_visible();expect(page.get_by_role('region',name='Session summary')).to_contain_text('Active');assert len(set(seen))==size;fits(page)
   assert not re.search(r'[?&]page=[2-9]',page.url),'Focused queue incremented an offset page'
   button(page,'Review and finalize attendance').click();button(page,'Finalize and mark remaining Absent').click();expect(page.get_by_role('region',name='Session summary')).to_contain_text('Finalized');expect(page.get_by_label('Attendance filter')).to_be_visible()
  assert not errors,errors
 except Exception:
  with suppress(Exception):page.screenshot(path=str(scratch/'focus-failed.png'),full_page=True,timeout=3000)
  raise
 finally:browser.close()
print('PASS focused all outcomes/review, delayed/lost/malformed responses, original-key reload recovery, confirmed-save read failure, concurrent mark, search/view preservation, camera/manual,375/768/1440/1920,200% zoom,reduced motion,100/101/220 exact completion and deliberate finalization.')
