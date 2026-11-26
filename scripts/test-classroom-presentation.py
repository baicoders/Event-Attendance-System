import os,json,shutil,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
expect.set_options(timeout=15000)
base=os.environ['CLASSROOM_TEST_BASE'];F=json.loads(os.environ['CLASSROOM_PRESENTATION_FIXTURES']);student=os.environ['CLASSROOM_PRESENTATION_STUDENT']
out=Path('.superpowers/classroom-presentation/browser');out.mkdir(parents=True,exist_ok=True)
def auth(browser,key,width=1440):
 c=browser.new_context(viewport={'width':width,'height':900},reduced_motion='reduce');name,value=F[key]['cookie'].split('=',1);c.add_cookies([{'name':name,'value':value,'url':base,'httpOnly':True,'sameSite':'Lax'}]);c.add_init_script("if(!localStorage.getItem('attendance-workspace')) localStorage.setItem('attendance-workspace','CLASS')");return c
def bounds(page):
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Horizontal overflow'
 d=page.get_by_role('dialog')
 if d.count():
  page.wait_for_function("() => { const d=document.querySelector('[role=dialog]');if(!d)return false;const b=d.getBoundingClientRect();return b.x>=15&&b.y>=15&&b.right<=innerWidth-15&&b.bottom<=innerHeight-15 }",timeout=5000)
  b=d.bounding_box();assert b['x']>=15 and b['y']>=15 and b['x']+b['width']<=page.viewport_size['width']-15 and b['y']+b['height']<=page.viewport_size['height']-15, (b,page.viewport_size)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('google-chrome') or '/opt/google/chrome/chrome',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 c=auth(browser,'teacher');page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 for width in [375,768,1440,1920]:
  page.set_viewport_size({'width':width,'height':900});page.goto(base+'/class/settings');opener=page.get_by_role('link',name=re.compile('Account and password'));expect(opener).to_be_visible();opener.focus();page.keyboard.press('Enter');expect(page.get_by_role('dialog')).to_be_visible();expect(page.get_by_role('heading',name='Settings',exact=True,include_hidden=True)).to_be_visible();bounds(page);expect(page.get_by_role('dialog')).to_have_css('background-color','rgb(255, 255, 255)');expect(page.get_by_role('dialog')).to_have_css('opacity','1');page.screenshot(path=str(out/('account-'+str(width)+'.png')))
  if width==375:
   page.set_viewport_size({'width':187,'height':450});bounds(page);expect(page.get_by_role('button',name='Sign out',exact=True)).to_be_visible();expect(page.get_by_role('button',name='Back',exact=True)).to_be_visible();page.set_viewport_size({'width':width,'height':900})
  page.keyboard.press('Escape');expect(page.get_by_role('dialog')).to_have_count(0);expect(opener).to_be_focused();page.go_forward();expect(page.get_by_role('dialog')).to_be_visible();page.get_by_role('button',name='Close',exact=True).click();expect(page.get_by_role('dialog')).to_have_count(0)
 # Events dialog retains request keys after a lost acknowledgement and blocks submission dismissal.
 page.goto(base+'/class/settings');page.get_by_role('link',name=re.compile('Events workspace access')).click();expect(page.get_by_role('dialog')).to_be_visible();bounds(page);keys=[];held_events=[]
 def hold_application(route):
  keys.append(route.request.post_data_json['commandId']);held_events.append(route)
 page.route('**/api/auth/events-application',hold_application);page.get_by_role('button',name='Request organizer access',exact=True).click();expect(page.get_by_role('button',name='Submitting…',exact=True)).to_be_visible();page.keyboard.press('Escape');expect(page.get_by_role('dialog')).to_be_visible();held_events[0].abort();expect(page.get_by_role('button',name='Request organizer access',exact=True)).to_be_enabled();page.unroute('**/api/auth/events-application');
 def replay_application(route):
  keys.append(route.request.post_data_json['commandId']);route.continue_()
 page.route('**/api/auth/events-application',replay_application);page.get_by_role('button',name='Request organizer access',exact=True).click();expect(page.get_by_role('heading',name='Events access pending',exact=True)).to_be_visible();assert len(keys)==2 and keys[0]==keys[1];page.unroute('**/api/auth/events-application');page.keyboard.press('Escape');expect(page.get_by_role('dialog')).to_have_count(0)
 # Root navigation clears the parallel slot after an intercepted dialog.
 page.get_by_role('link',name=re.compile('Account and password')).click();expect(page.get_by_role('dialog')).to_be_visible();page.get_by_role('dialog').evaluate("el => { const a=document.createElement('a');a.href='/';a.textContent='Go home test';el.append(a); }");page.get_by_role('link',name='Go home test',exact=True).click();expect(page.get_by_role('dialog')).to_have_count(0)
 # Origin state and browser Back/Forward.
 page.goto(base+'/class/students?q=Rivera');expect(page.get_by_label('Search students',exact=True)).to_have_value('Rivera');page.get_by_role('link',name='Account settings',exact=True).first.click();expect(page.get_by_role('dialog')).to_be_visible();expect(page.get_by_label('Search students',exact=True)).to_have_value('Rivera');assert page.locator('a[href="/class/students"][aria-current]').count()>0;page.go_back();expect(page.get_by_role('dialog')).to_have_count(0);expect(page.get_by_label('Search students',exact=True)).to_have_value('Rivera');page.go_forward();expect(page.get_by_role('dialog')).to_be_visible()
 # Refresh uses full-screen neutral fallback; return respects workspace.
 page.reload();expect(page.get_by_role('dialog')).to_be_visible();expect(page.get_by_role('heading',name='Settings',exact=True)).to_have_count(0);page.get_by_role('button',name='Return to workspace',exact=True).click();expect(page).to_have_url(base+'/class')
 # Direct Events access with Events preference must have a usable return destination.
 page.evaluate("localStorage.setItem('attendance-workspace','EVENTS')");page.goto(base+'/account/events-access');expect(page.get_by_role('dialog')).to_be_visible();page.get_by_role('button',name='Return to workspace',exact=True).click();expect(page).to_have_url(base+'/class');page.evaluate("localStorage.setItem('attendance-workspace','CLASS')")
 # Pending password submission blocks every dismissal path, including traversal.
 page.goto(base+'/class/settings')
 page.get_by_role('link',name=re.compile('Account and password')).click()
 expect(page.get_by_role('dialog')).to_be_visible()
 page.evaluate("window.__presentationTraversals=0; window.addEventListener('popstate',()=>window.__presentationTraversals++,true)")
 page.get_by_label('Current password',exact=True).fill('presentation-test-password')
 page.get_by_label('New password',exact=True).fill('presentation-new-password')
 page.get_by_label('Confirm new password',exact=True).fill('presentation-new-password')
 held=[]
 page.route('**/api/auth/change-password',lambda route:held.append(route))
 page.get_by_role('button',name='Change password',exact=True).click()
 expect(page.get_by_role('button',name='Saving…',exact=True)).to_be_visible()
 page.keyboard.press('Escape')
 expect(page.get_by_role('dialog')).to_be_visible()
 expect(page.get_by_role('button',name='Back',exact=True)).to_be_disabled()
 page.evaluate('history.back()')
 page.wait_for_timeout(350) # Allow both the attempted traversal and its guarded restoration to dispatch.
 expect(page.get_by_role('dialog')).to_be_visible()
 expect(page).to_have_url(base+'/account/settings')
 held[0].fulfill(status=400,content_type='application/json',body=json.dumps({'message':'Test rejection'}))
 page.unroute('**/api/auth/change-password')
 expect(page.get_by_role('button',name='Change password',exact=True)).to_be_enabled()
 page.keyboard.press('Escape');expect(page.get_by_role('dialog')).to_have_count(0);page.go_forward();expect(page.get_by_role('dialog')).to_be_visible()
 # Lazy history, optional note, and student deep link resolution.
 requests=[];page.on('request',lambda r:requests.append(r.url));page.goto(base+'/class/students/'+student);expect(page.get_by_role('heading',name='Rivera, Alex',exact=True)).to_be_visible();expect(page.get_by_role('button',name='Verify details',exact=True)).to_be_visible();expect(page.get_by_text('Checked against the school register.',exact=True)).to_be_visible();assert not any('/changes?' in x for x in requests);expect(page.get_by_label('Verification note (optional)',exact=True)).not_to_be_visible();page.get_by_text('Add a note',exact=True).click();expect(page.get_by_label('Verification note (optional)',exact=True)).to_be_visible();page.get_by_text('Change history',exact=True).click();expect(page.get_by_text('Student record added',exact=True)).to_be_visible();assert any('/changes?' in x for x in requests)
 held_students=[];page.route('**/api/classroom/students/'+student,lambda route:held_students.append(route))
 page.goto(base+'/class/reports?studentId='+student+'&from=2026-01-01&to=2026-01-31');expect(page.get_by_role('radio',name='Student',exact=True)).to_be_checked();expect(page.get_by_role('status').filter(has_text='Loading selected student…')).to_be_visible();assert held_students;held_students[0].continue_();page.unroute('**/api/classroom/students/'+student);expect(page.get_by_role('region',name='Report selection summary')).to_contain_text('Alex Rivera');expect(page.get_by_role('region',name='Report selection summary')).to_contain_text('USN 00000999123');expect(page.get_by_label('From school date (optional)',exact=True)).to_be_visible();bounds(page)
 for width in [375,768,1440,1920]:
  page.set_viewport_size({'width':width,'height':900});bounds(page);page.screenshot(path=str(out/('report-'+str(width)+'.png')),full_page=True);page.evaluate("document.documentElement.style.zoom='2'");bounds(page);page.evaluate("document.documentElement.style.zoom='1'")
 # A mobile account-menu opener retains report state and scroll, and regains focus.
 page.set_viewport_size({'width':375,'height':900});page.evaluate('window.scrollTo(0,500)');origin_scroll=page.evaluate('scrollY')
 menu=page.get_by_role('button',name=re.compile('Account menu for'))
 menu.click();page.get_by_role('menuitem',name='Account settings',exact=True).click();expect(page.get_by_role('dialog')).to_be_visible();assert page.evaluate('scrollY')==origin_scroll
 page.keyboard.press('Escape');expect(page.get_by_role('dialog')).to_have_count(0);expect(menu).to_be_focused();assert page.evaluate('scrollY')==origin_scroll;expect(page.get_by_role('radio',name='Student',exact=True)).to_be_checked()
 # Native radio keyboard operation selects the adjacent report type.
 page.get_by_role('radio',name='Student',exact=True).focus();page.keyboard.press('ArrowRight');expect(page.get_by_role('radio',name='Day',exact=True)).to_be_checked()
 page.get_by_role('radio',name='Day',exact=True).click();expect(page.get_by_label('School date (Asia/Manila)',exact=True)).to_be_visible();expect(page.get_by_label('Find student by name, USN or LRN',exact=True)).to_have_count(0);page.get_by_role('radio',name='Meeting',exact=True).click();expect(page.get_by_role('combobox',name='Attendance meeting',exact=True)).to_be_visible();expect(page.get_by_label('School date (Asia/Manila)',exact=True)).to_have_count(0)
 # Read failures cannot masquerade as resolved selections.
 page.route('**/api/classroom/students/'+student,lambda r:r.fulfill(status=503,content_type='application/json',body=json.dumps({'message':'Unavailable'})));page.reload();page.get_by_role('radio',name='Student',exact=True).click();expect(page.get_by_role('button',name='Retry student',exact=True)).to_be_visible();page.unroute('**/api/classroom/students/'+student);page.get_by_role('button',name='Retry student',exact=True).click();expect(page.get_by_role('region',name='Report selection summary')).to_contain_text('Alex Rivera')
 page.goto(base+'/class/reports?studentId=presentation-unavailable');expect(page.get_by_text('This student is unavailable under your current access. Choose another student.',exact=True)).to_be_visible();expect(page.get_by_role('button',name='Prepare report',exact=True)).to_be_disabled();page.get_by_role('button',name='Change selection',exact=True).click();expect(page.get_by_label('Find student by name, USN or LRN',exact=True)).to_be_visible()
 for key in ['forced','disabled']:
  restricted=auth(browser,key,375);v=restricted.new_page();v.goto(base+'/account/settings');expect(v.get_by_role('dialog')).to_be_visible();v.keyboard.press('Escape');expect(v.get_by_role('dialog')).to_be_visible();expect(v.get_by_role('button',name='Close',exact=True)).to_have_count(0);expect(v.get_by_role('button',name='Sign out',exact=True)).to_be_visible();bounds(v);restricted.close()
 for key in ['events','admin']:
  permitted=auth(browser,key);v=permitted.new_page();v.goto(base+'/account/events-access');expect(v).to_have_url(base+'/dashboard');permitted.close()
 assert not errors,errors
 browser.close()
print('PASS responsive dialogs, history routing/focus, blocked submission, lazy student history, named report deep links and restricted states')
