import os, json, shutil, uuid
from pathlib import Path
from urllib.request import Request,urlopen
from playwright.sync_api import sync_playwright,expect
expect.set_options(timeout=30000)
base=os.environ['CLASSROOM_TEST_BASE'];cookie=os.environ['CLASSROOM_TEACHER_COOKIE'];student_id=os.environ['CLASSROOM_STUDENT_ID'];path='/api/classroom/students/'+student_id

def api(method,body=None):
 request=Request(base+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers={'cookie':cookie,'origin':base,'content-type':'application/json'})
 with urlopen(request) as response:return json.load(response)['data']

def no_overflow(page):
 if not page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'):
  Path('.superpowers/classroom-tests').mkdir(parents=True,exist_ok=True)
  page.screenshot(path='.superpowers/classroom-tests/student-overflow.png',full_page=True)
  offending=page.evaluate("[...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,slot:e.getAttribute('data-slot'),className:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})).filter(e=>e.right>window.innerWidth+0.5).slice(0,15)")
  raise AssertionError('Unexpected horizontal scrolling: '+json.dumps(offending))

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('google-chrome') or '/opt/google/chrome/chrome',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--renderer-process-limit=2'])
 context=browser.new_context(viewport={'width':375,'height':812});name,value=cookie.split('=',1);context.add_cookies([{'name':name,'value':value,'url':base,'httpOnly':True,'sameSite':'Lax','secure':False}]);page=context.new_page()
 page.goto(base+'/class/students');expect(page.get_by_role('heading',name='Students',exact=True)).to_be_visible();expect(page.get_by_text('1 students · 100 per page',exact=True)).to_be_visible();no_overflow(page)
 page.get_by_label('Search students',exact=True).fill('Corrected');page.get_by_role('link',name='Student, Corrected',exact=False).click();expect(page.get_by_role('heading',name='Student, Corrected',exact=True)).to_be_visible();no_overflow(page)
 page.get_by_role('button',name='Correct information',exact=True).click();page.get_by_label('First name',exact=True).fill('MobileName');page.get_by_label('Reason for correction',exact=True).fill('Checked school card with student')
 current=api('GET');api('PATCH',{'commandId':str(uuid.uuid4()),'expectedVersion':current['editVersion'],'student':{'lastName':'Concurrent surname'},'reason':'Concurrent verified surname'})
 page.get_by_role('button',name='Save correction',exact=True).click();expect(page.get_by_role('alert').filter(has_text='Another person updated')).to_be_visible();expect(page.get_by_label('First name',exact=True)).to_have_value('MobileName')
 page.get_by_role('button',name='Reload latest and keep my edited fields',exact=True).click();expect(page.get_by_text('Your edited fields are retained.',exact=False)).to_be_visible();page.get_by_role('button',name='Save correction',exact=True).click();expect(page.get_by_role('dialog')).to_have_count(0);expect(page.get_by_role('heading',name='Concurrent surname, MobileName',exact=True)).to_be_visible();assert api('GET')['lastName']=='Concurrent surname'
 page.get_by_role('button',name='Correct information',exact=True).click();page.get_by_label('USN',exact=True).fill('00000123458');page.get_by_label('Existing printed QR cards',exact=True).select_option('KEEP_ALIAS_CONFIRMED');page.get_by_label('Reason for correction',exact=True).fill('Confirmed existing card belongs to this student');page.get_by_role('button',name='Save correction',exact=True).click();expect(page.get_by_role('dialog')).to_have_count(0)
 page.get_by_label('Verification note (optional)',exact=True).fill('Checked current record on phone');page.get_by_role('button',name='Mark verified',exact=True).click();expect(page.get_by_role('status').filter(has_text='Verified')).to_be_visible()
 page.get_by_role('button',name='Correct information',exact=True).click();page.get_by_label('First name',exact=True).fill('NoAck');page.get_by_label('Reason for correction',exact=True).fill('Network acknowledgment test')
 def drop_ack(route):
  if route.request.method=='PATCH':route.fetch();route.abort()
  else:route.continue_()
 page.route(base+path,drop_ack);page.get_by_role('button',name='Save correction',exact=True).click();expect(page.get_by_role('alert').filter(has_text='Save not confirmed')).to_be_visible();expect(page.get_by_label('First name',exact=True)).to_have_value('NoAck')
 page.unroute(base+path,drop_ack);page.get_by_role('button',name='Save correction',exact=True).click();expect(page.get_by_role('dialog')).to_have_count(0);expect(page.get_by_role('heading',name='Concurrent surname, NoAck',exact=True)).to_be_visible();no_overflow(page)
 Path('.superpowers/classroom-tests').mkdir(parents=True,exist_ok=True);page.screenshot(path='.superpowers/classroom-tests/student-375.png',full_page=True);browser.close()
print('PASS 375px teacher correction, preserved draft/concurrent surname, explicit QR alias, verification and lost-acknowledgment idempotent retry.')
