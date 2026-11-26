"""Read-only walkthrough against an explicit existing demo fixture; never seeds or resets."""
import json, os, shutil, re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
expect.set_options(timeout=30000)
fixture=Path(os.environ['CLASSROOM_UI_FIXTURE'])
F=json.loads(fixture.read_text())
base=os.environ.get('CLASSROOM_TEST_BASE','http://127.0.0.1:3003')
out=Path(os.environ.get('CLASSROOM_UI_ARTIFACTS','.superpowers/classroom-overhaul/browser'));out.mkdir(parents=True,exist_ok=True)
widths=[375,768,1440,1920]
results=[]
def no_overflow(page):
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),page.url+' overflows'
 assert page.evaluate("[...document.querySelectorAll('[data-slot=select-trigger]')].filter(e=>e.getClientRects().length).every(e=>{const card=e.closest('[data-slot=card]');if(!card)return true;const r=e.getBoundingClientRect(),c=card.getBoundingClientRect();return r.right<=c.right+1&&r.left>=c.left-1})"),page.url+' clips a selector'
def login(browser,account):
 context=browser.new_context(viewport={'width':375,'height':900},reduced_motion='reduce')
 response=context.request.post(base+'/api/auth/login',headers={'Origin':base},data={'email':F['accounts'][account]['email'],'password':F['password'],'workspace':'CLASS'})
 assert response.status==200,(account,response.status)
 context.add_cookies([{**cookie,'secure':False} for cookie in context.cookies()])
 return context
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('google-chrome') or '/opt/google/chrome/chrome',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--renderer-process-limit=2'])
 try:
  teacher=login(browser,'teacher');page=teacher.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  class_id=F['classes']['programming']['id'];term_id=F['term']['id']
  directory=teacher.request.get(base+'/api/classroom/students?pageSize=100').json()['data'];student_id=directory['items'][0]['id']
  meetings=teacher.request.get(base+'/api/classroom/classes/'+class_id+'/sessions?pageSize=100').json()['data']['items']
  routes=[('/class','Welcome'),('/class/classes','My Classes'),('/class/attendance','Attendance'),('/class/attendance?view=start','Attendance'),('/class/classes/'+class_id,teacher.request.get(base+'/api/classroom/classes/'+class_id).json()['data']['displayName']),('/class/classes/new','Create'),('/class/classes/'+class_id+'/settings',teacher.request.get(base+'/api/classroom/classes/'+class_id).json()['data']['displayName']),('/class/classes/'+class_id+'/roster',teacher.request.get(base+'/api/classroom/classes/'+class_id).json()['data']['displayName']),('/class/classes/'+class_id+'/start','Start attendance'),('/class/students','Find the right student'),('/class/students/'+student_id,''),('/class/settings','Settings'),('/class/onboarding?help=1','Teacher guide & help'),('/class/reports?termId='+term_id+'&classId='+class_id,'Attendance reports'),('/class/sessions/'+F['activeSessionId'],'')]
  for meeting in meetings:
   if meeting['state']!='ACTIVE':routes.append(('/class/sessions/'+meeting['id'],''))
  for index,(route,title) in enumerate(routes):
   page.goto(base+route)
   heading=page.get_by_role('dialog').get_by_role('heading',name='Start attendance',exact=True) if route.endswith('/start') else page.locator('h1:visible')
   expect(heading).to_be_visible()
   if title:expect(heading).to_contain_text(title,ignore_case=True)
   page.wait_for_load_state('networkidle')
   for width in widths:
    page.set_viewport_size({'width':width,'height':1000});no_overflow(page)
    if width==375 and index==4:
     summary=page.locator('[data-slot=card]').filter(has=page.get_by_role('heading',name='Meeting history',exact=True)).locator('li').first
     assert summary.locator(':scope > div').first.bounding_box()['width']>=summary.bounding_box()['width']-50,'Mobile meeting identity is squeezed beside its actions'
    if width in [375,1440] and index in [0,2,4,5,9,13,14]:page.screenshot(path=str(out/(str(index)+'-'+str(width)+'.png')),full_page=True)
   page.evaluate("document.body.style.zoom='2'");no_overflow(page);page.evaluate("document.body.style.zoom='1'")
   results.append({'route':route,'widths':widths,'zoom':200})
  page.goto(base+'/class/classes/'+class_id);page.get_by_role('button',name='Class options',exact=True).focus();page.keyboard.press('Enter');expect(page.get_by_role('menu')).to_be_visible();page.keyboard.press('Escape');expect(page.get_by_role('button',name='Class options',exact=True)).to_be_focused()
  page.goto(base+'/class/classes/new');page.wait_for_load_state('networkidle');select=page.get_by_role('combobox',name='Subject',exact=True);expect(select).to_be_enabled();select.focus();page.keyboard.press('ArrowDown');expect(page.get_by_role('listbox')).to_be_visible();page.keyboard.press('Escape');expect(select).to_be_focused()
  page.goto(base+'/class/classes?q=no-such-class-xyz');expect(page.get_by_text('No classes in this view',exact=True)).to_be_visible()
  page.goto(base+'/class/attendance?view=start&q=Programming');expect(page.get_by_label('Find a class',exact=True)).to_have_value('Programming');page.get_by_role('link',name='Active meetings',exact=True).click();expect(page.get_by_role('link',name='Active meetings',exact=True)).to_have_attribute('aria-current','page');expect(page.get_by_label('Find a class',exact=True)).to_have_value('Programming');assert 'q=Programming' in page.url
  assert not errors,errors
  admin=login(browser,'admin');a=admin.new_page();admin_errors=[];a.on('pageerror',lambda e:admin_errors.append(str(e)))
  teacher_id=F['accounts']['teacher'].get('id') or F['accounts']['teacher'].get('userId')
  admin_routes=['/class','/class/admin/teachers','/class/admin/classes','/class/admin/catalog','/class/admin/activity','/class/settings','/class/admin/classes/'+class_id,'/class/admin/classes/'+class_id+'/settings','/class/admin/classes/'+class_id+'/roster','/class/admin/classes/new','/class/classes/'+class_id+'/start']
  if teacher_id:admin_routes.append('/class/admin/teachers/'+teacher_id)
  for route in admin_routes:
   a.goto(base+route);expect(a.locator('h1:visible')).to_be_visible();a.wait_for_load_state('networkidle')
   for width in widths:a.set_viewport_size({'width':width,'height':1000});no_overflow(a)
   a.set_viewport_size({'width':375,'height':900})
   if '/start' not in route:
    nav=a.get_by_role('navigation',name='Primary',exact=True);expect(nav.get_by_role('link',name='Catalog',exact=True)).to_be_visible();expect(nav.get_by_role('link',name='Settings',exact=True)).to_be_visible();assert nav.get_by_role('link').count()==5
   results.append({'adminRoute':route,'widths':widths})
  assert not admin_errors,admin_errors
  for account in ['pending','rejected','suspended','newteacher']:
   context=login(browser,account);c=context.new_page();c.goto(base+'/class/access' if account!='newteacher' else base+'/class/onboarding');expect(c.locator('h1:visible')).to_be_visible();c.wait_for_load_state('networkidle')
   for width in widths:c.set_viewport_size({'width':width,'height':1000});no_overflow(c)
   results.append({'accessState':account,'widths':widths});context.close()
  (out/'results.json').write_text(json.dumps(results,indent=2));print('PASS '+str(len(results))+' route/state walkthroughs at four widths; 200% zoom, role navigation, keyboard menus/select, empty state and preserved attendance filters. No saved demo writes.')
 finally:browser.close()
