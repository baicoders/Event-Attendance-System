import json,os,shutil,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
expect.set_options(timeout=30000)
F=json.loads(Path(os.environ['CLASSROOM_REPORT_FIXTURE']).read_text());base=F['base'];artifacts=Path(F['artifacts'])
def context_for(browser,cookie):
 c=browser.new_context(viewport={'width':375,'height':812},accept_downloads=True);name,value=cookie.split('=',1);c.add_cookies([{'name':name,'value':value,'url':base,'httpOnly':True,'sameSite':'Lax'}]);return c
def no_overflow(page):
 if page.evaluate('document.documentElement.scrollWidth>innerWidth'):
  diagnostics=page.evaluate("""() => ({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].map(el=>({tag:el.tagName,cls:el.className?.baseVal??el.className,text:el.textContent?.slice(0,90),left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,width:el.getBoundingClientRect().width})).filter(el=>el.width>0&&(el.right>innerWidth||el.left<0)).slice(0,35)})""")
  page.screenshot(path=str(artifacts/'overflow-failure.png'),full_page=True)
  raise AssertionError('Report overflow: '+json.dumps(diagnostics))
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('google-chrome') or '/opt/google/chrome/chrome',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--renderer-process-limit=2'])
 try:
  context=context_for(browser,F['teacher']['cookie']);page=context.new_page();page.goto(base+'/class/reports?sessionId='+F['own']['sessionId']+'&classId='+F['own']['classId']+'&termId='+F['term']['id']);expect(page.get_by_role('region',name='Report totals')).to_contain_text('50.0%');expect(page.get_by_role('region',name='Student report rows').locator('details')).to_have_count(6);no_overflow(page)
  page.evaluate("document.documentElement.style.zoom='2'");no_overflow(page);page.screenshot(path=str(artifacts/'reports-375-zoom200.png'),full_page=True);page.evaluate("document.documentElement.style.zoom='1'")
  page.get_by_role('button',name='Export',exact=True).click()
  with page.expect_download() as info:page.get_by_role('menuitem',name='Summary CSV',exact=True).click()
  csv=Path(info.value.path()).read_text();assert F['reportVersion'] in csv;assert "'00000000001" in csv;assert 'PRIVATE EXCUSE' not in csv
  with page.expect_popup() as info:page.get_by_role('link',name='Print',exact=True).click()
  printed=info.value;expect(printed.get_by_role('heading',name='Classroom attendance report',exact=True)).to_be_visible();expect(printed.get_by_role('region',name='Report totals')).to_contain_text('50.0%');assert F['reportVersion'] in printed.content();printed.emulate_media(media='print');printed.pdf(path=str(artifacts/'report.pdf'));printed.close()
  # A separately authorized correction invalidates the displayed version.
  admin_context=context_for(browser,F['admin']['cookie'])
  page.wait_for_load_state('networkidle')
  response=admin_context.request.put(base+'/api/classroom/sessions/'+F['own']['sessionId']+'/attendance/report-student-1',headers={'Origin':base},data={'commandId':str(__import__('uuid').uuid4()),'status':'PRESENT','expectedRevision':2,'reason':'Administrator verified the omitted student'})
  assert response.status==200,response.text()
  downloads=[];page.on('download',lambda download:downloads.append(download));page.get_by_role('button',name='Export',exact=True).click();page.get_by_role('menuitem',name='Summary CSV',exact=True).click();expect(page.get_by_role('alert').filter(has_text='Attendance changed')).to_be_visible();assert not downloads,'Changed report produced a download'
  page.get_by_role('button',name='Refresh report',exact=True).click();expect(page.get_by_role('region',name='Report totals')).to_contain_text('75.0%');expect(page.get_by_role('alert').filter(has_text='Attendance changed')).to_have_count(0);assert page.get_by_role('region',name='Report totals').get_attribute('data-report-version')!=F['reportVersion']
  # Typed lookup reveals only this teacher's historical student attendance.
  page.get_by_role('radio',name='Student',exact=True).check();page.get_by_role('combobox',name='Class',exact=True).click();page.get_by_role('option',name='All authorized classes',exact=True).click();page.get_by_label('Find student by name, USN or LRN').fill('00000000001');page.get_by_role('button',name=re.compile('Ñ Name, original')).click();page.get_by_role('combobox',name='Report range',exact=True).click();page.get_by_role('option',name='Custom dates',exact=True).click();page.get_by_label('From school date (optional)',exact=True).fill(F['own']['schoolDate']);page.get_by_label('To school date (optional)',exact=True).fill(F['own']['schoolDate']);page.get_by_role('button',name='Prepare report',exact=True).click();expect(page.get_by_role('region',name='Report totals')).to_contain_text('100.0%');expect(page.get_by_role('region',name='Student meeting history').locator('article')).to_have_count(1);assert 'Other private class' not in page.get_by_role('region',name='Student meeting history').inner_text();no_overflow(page)
  page.get_by_role('radio',name='Day',exact=True).check();page.get_by_label('School date (Asia/Manila)',exact=True).fill(F['own']['schoolDate']);page.get_by_role('button',name='Prepare report',exact=True).click();expect(page.get_by_role('region',name='Report totals')).to_contain_text('75.0%');no_overflow(page)
  # Table lookup narrows rows while totals, trend and full export remain scoped to the report.
  page.get_by_label('Search students in this report').fill('Student 5');expect(page.get_by_role('region',name='Student report rows').locator('details')).to_have_count(1);expect(page.get_by_role('region',name='Report totals')).to_contain_text('75.0%');expect(page.get_by_text('1 matching students of 6',exact=False)).to_be_visible()
  page.get_by_role('region',name='Student report rows').locator('summary').click();expect(page.get_by_role('region',name='Student report rows').get_by_text('Excused',exact=True)).to_be_visible()
  page.get_by_role('button',name='Export',exact=True).click()
  with page.expect_download() as info:page.get_by_role('menuitem',name='Summary CSV',exact=True).click()
  full_csv=Path(info.value.path()).read_text();assert len(full_csv.strip().splitlines())==7,'Table search narrowed full CSV';assert "'00000000001" in full_csv
  page.get_by_label('Search students in this report').fill('not-a-student');expect(page.get_by_text('No students match this search.',exact=False)).to_be_visible();expect(page.get_by_role('region',name='Report totals')).to_contain_text('75.0%');page.get_by_label('Search students in this report').fill('');expect(page.get_by_role('region',name='Student report rows').locator('details')).to_have_count(6)
  page.get_by_text('How this report is calculated',exact=True).click();expect(page.get_by_text('Numerator:',exact=False)).to_have_count(0);expect(page.get_by_text('Denominator:',exact=False)).to_have_count(0);no_overflow(page);page.get_by_text('How this report is calculated',exact=True).click()
  # Desktop uses a compact semantic table; meeting view has no date range controls.
  page.set_viewport_size({'width':1440,'height':1000});expect(page.get_by_role('table')).to_be_visible();expect(page.get_by_role('table').locator('tbody tr')).to_have_count(6);no_overflow(page);page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(artifacts/'reports-1440.png'),full_page=True)
  page.get_by_role('radio',name='Meeting',exact=True).check();expect(page.get_by_label('Attendance meeting',exact=True)).to_be_visible();expect(page.get_by_label('From school date (optional)',exact=True)).to_have_count(0);expect(page.get_by_label('To school date (optional)',exact=True)).to_have_count(0);page.get_by_role('radio',name='Day',exact=True).check();page.set_viewport_size({'width':375,'height':812});page.evaluate('window.scrollTo(0,0)')
  page.screenshot(path=str(artifacts/'reports-375.png'),full_page=True)
  period_response=admin_context.request.patch(base+'/api/classroom/terms/'+F['term']['id'],headers={'Origin':base},data={
   'commandId':str(__import__('uuid').uuid4()),'expectedRevision':0,'reason':'Set the beta grading calendar',
   'gradingPeriods':[{'name':'Prelim','startDate':F['own']['schoolDate'],'endDate':F['own']['schoolDate']}],
  })
  assert period_response.status==200,period_response.text()
  page.goto(base+'/class/reports?view=class&classId='+F['own']['classId']+'&termId='+F['term']['id'])
  student_rows=page.get_by_role('region',name='Student report rows')
  expect(page.get_by_role('tab',name='Students')).to_have_attribute('aria-selected','true')
  expect(student_rows.locator('details')).to_have_count(6);no_overflow(page)
  assert page.get_by_role('region',name='Report totals').evaluate(
   "(totals) => !!(totals.compareDocumentPosition(document.querySelector('[aria-label=\"Class attendance details\"]')) & Node.DOCUMENT_POSITION_FOLLOWING)")
  page.get_by_role('tab',name='Meetings').click()
  meeting_panel=page.get_by_role('tabpanel',name='Meetings')
  expect(meeting_panel.get_by_role('link')).to_have_count(13)
  assert F['own']['sessionId'] in meeting_panel.get_by_role('link').first.get_attribute('href')
  no_overflow(page)
  page.get_by_role('tab',name='Students').click()

  page.get_by_role('combobox',name='Report range',exact=True).click();page.get_by_role('option',name='Grading period',exact=True).click()
  page.get_by_role('combobox',name='Grading period',exact=True).click();page.get_by_role('option',name=re.compile('^Prelim')).click()
  page.get_by_role('button',name='Prepare report',exact=True).click()
  expect(page).to_have_url(re.compile('gradingPeriodId='))
  expect(student_rows.locator('details')).to_have_count(6)

  search=page.get_by_label('Search students in this report')
  search.fill('Student 5');expect(student_rows.locator('details')).to_have_count(1)
  student_rows.locator('summary').click()
  student_link=student_rows.get_by_role('link',name='View student report').get_attribute('href')
  assert 'gradingPeriodId=' in student_link and 'studentId=report-student-5' in student_link
  student_page=context.new_page();student_page.goto(base+student_link)
  expect(student_page.get_by_role('combobox',name='Grading period',exact=True)).to_contain_text('Prelim')
  expect(student_page.get_by_role('region',name='Student meeting history').locator('article')).to_have_count(1)
  student_page.get_by_role('button',name='Prepare report',exact=True).click()
  expect(student_page).to_have_url(re.compile('gradingPeriodId='))
  student_page.close()
  page.get_by_role('tab',name='Meetings').click()
  expect(meeting_panel.get_by_role('link')).to_have_count(1)
  page.get_by_role('tab',name='Students').click()
  expect(search).to_have_value('Student 5');expect(student_rows.locator('details')).to_have_count(1)
  with page.expect_download() as excel:page.get_by_role('button',name='Download Excel',exact=True).click()
  assert excel.value.suggested_filename.endswith('.xlsx')
  excel.value.save_as(str(artifacts/'attendance-report.xlsx'))
  with page.expect_popup() as info:page.get_by_role('link',name='Print',exact=True).click()
  printed=info.value;expect(printed.get_by_role('heading',name='Class attendance report',exact=True)).to_be_visible()
  expect(printed.get_by_role('table',name='Student summary').locator('tbody tr')).to_have_count(6)
  expect(printed.get_by_role('region',name='Attendance by student').locator('tbody tr')).to_have_count(6)
  attendance=printed.get_by_role('region',name='Attendance by student')
  expect(attendance.get_by_role('columnheader',name='Meeting date',exact=True)).to_have_count(6)
  expect(attendance.get_by_role('cell',name='Excused',exact=True)).to_have_count(2)
  expect(attendance.locator('time').first).to_have_attribute('datetime',F['own']['schoolDate'])

  expect(printed.get_by_text(re.compile('Prelim'))).to_be_visible()
  printed.emulate_media(media='print');printed.pdf(path=str(artifacts/'register.pdf'),prefer_css_page_size=True);printed.close()
  page.get_by_role('tab',name='Meetings').click()
  meeting_panel.get_by_role('link').click()
  expect(page.get_by_role('heading',name='Meeting attendance',exact=True)).to_be_visible()
  expect(page.get_by_role('combobox',name='Grading period',exact=True)).to_contain_text('Prelim')
  page.get_by_role('combobox',name='Attendance meeting',exact=True).click()
  expect(page.get_by_role('option',name=re.compile(' · finalized$'))).to_have_count(1)
  page.keyboard.press('Escape')
  page.goto(base+'/class/reports?view=class&classId='+F['own']['classId']+'&termId='+F['term']['id'])
  with page.expect_popup() as info:page.get_by_role('link',name='Print',exact=True).click()
  wide=info.value;expect(wide.get_by_role('table',name='Student summary').locator('tbody tr')).to_have_count(6)
  expect(wide.get_by_role('region',name='Attendance by student').locator('tbody tr')).to_have_count(78)
  wide.emulate_media(media='print');wide.pdf(path=str(artifacts/'wide-register.pdf'),prefer_css_page_size=True);wide.close()
  admin=admin_context.new_page();admin.goto(base+'/class/admin/activity?actorId='+F['teacher']['id']);expect(admin.get_by_role('heading',name='Classroom activity',exact=True)).to_be_visible();admin.get_by_role('combobox',name='Activity type',exact=True).click();admin.get_by_role('option',name='Attendance changes',exact=True).click();admin.get_by_text('Advanced filters · internal references',exact=True).click();admin.get_by_label('Exact action (optional)',exact=True).fill('CORRECT');admin.get_by_role('button',name='Apply filters',exact=True).click();admin.get_by_role('button',name='Inspect change',exact=True).first.click();expect(admin.get_by_role('heading',name='Activity details',exact=True)).to_be_visible();admin.get_by_text('Before and after · technical record',exact=True).click();expect(admin.get_by_role('dialog',name='Activity details',exact=True).get_by_text('Corrected after verifying the record',exact=True)).to_be_visible();assert 'PRIVATE EXCUSE' not in admin.get_by_role('dialog').inner_text();no_overflow(admin);admin.keyboard.press('Escape');admin.goto(base+'/class/admin/teachers/'+F['teacher']['id']);expect(admin.get_by_role('heading',name=F['teacher']['name'],exact=True)).to_be_visible();admin.get_by_role('link',name='View teacher classes',exact=True).click();expect(admin.get_by_role('link',name='Open class',exact=True)).to_have_count(1);assert 'Other private class' not in admin.locator('main').inner_text();no_overflow(admin);admin.screenshot(path=str(artifacts/'monitoring-375.png'),full_page=True)
 finally:browser.close()
print('PASS375px report/session/student/day filters, same-version CSV and printable PDF, private student-term history, admin correction timeline/detail/teacher assistance navigation and overflow.')
