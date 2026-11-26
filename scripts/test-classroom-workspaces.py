import os
import shutil
from pathlib import Path
import json
from urllib.request import Request, urlopen
from playwright.sync_api import sync_playwright, expect

expect.set_options(timeout=30000)
base = os.environ['CLASSROOM_TEST_BASE']

def authenticate(context, cookie):
    name, value = cookie.split('=', 1)
    context.add_cookies([{'name': name, 'value': value, 'url': base, 'httpOnly': True, 'sameSite': 'Lax', 'secure': False}])

def no_overflow(page):
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Page horizontally overflows 375px'

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=shutil.which('google-chrome') or '/opt/google/chrome/chrome', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage', '--renderer-process-limit=2'])
    anonymous = browser.new_context(viewport={'width': 375, 'height': 812})
    page = anonymous.new_page()
    page.route('**/api/auth/session', lambda route: route.abort())
    page.goto(base + '/login?workspace=CLASS')
    expect(page.get_by_text('Unable to check sign-in.', exact=False)).to_be_visible()
    page.unroute('**/api/auth/session')
    page.get_by_role('button', name='Retry connection', exact=True).click()
    expect(page.get_by_role('radio', name='Class', exact=True)).to_be_checked()
    expect(page.get_by_label('Email', exact=True)).to_be_visible()
    page.get_by_role('radio', name='Events', exact=True).check()
    expect(page.get_by_role('radio', name='Events', exact=True)).to_be_checked()
    no_overflow(page)
    teacher = browser.new_context(viewport={'width': 375, 'height': 812})
    authenticate(teacher, os.environ['CLASSROOM_TEACHER_COOKIE'])
    view = teacher.new_page()
    view.goto(base + '/class')
    expect(view.get_by_role('heading', name='Welcome, Teacher', exact=True)).to_be_visible()
    expect(view.get_by_role('navigation', name='Primary').get_by_role('link', name='Classes', exact=True)).to_be_visible()
    expect(view.get_by_role('link', name='Calendar', exact=True)).to_have_count(0)
    no_overflow(view)
    view.goto(base + '/dashboard')
    view.wait_for_url('**/class')
    expect(view.get_by_role('heading', name='Welcome, Teacher', exact=True)).to_be_visible()
    view.goto(base + '/class/settings')
    expect(view.get_by_role('heading', name='Settings', exact=True)).to_be_visible()
    no_overflow(view)
    view.route('**/api/auth/session', lambda route: route.abort())
    view.evaluate("window.dispatchEvent(new Event('focus'))")
    expect(view.get_by_text('Connection unavailable.', exact=False)).to_be_visible()
    view.unroute('**/api/auth/session')
    view.get_by_role('button', name='Retry connection', exact=True).click()
    expect(view.get_by_role('heading', name='Settings', exact=True)).to_be_visible()
    pending = browser.new_context(viewport={'width': 375, 'height': 812})
    authenticate(pending, os.environ['CLASSROOM_PENDING_COOKIE'])
    status = pending.new_page()
    requests = []
    status.on('request', lambda request: requests.append(request.url))
    status.goto(base + '/class/access')
    expect(status.get_by_role('heading', name='Teacher access pending', exact=True)).to_be_visible()
    expect(status.get_by_role('button', name='Check status', exact=True)).to_be_visible()
    assert not any('/api/students' in url for url in requests)
    no_overflow(status)
    status.get_by_label('Department or teaching designation', exact=True).fill('Updated Faculty')
    with status.expect_response(lambda response: '/api/classroom/application' in response.url and response.request.method == 'PUT') as saved:
        status.get_by_role('button', name='Save application details', exact=True).click()
    assert saved.value.status == 200
    status.reload()
    expect(status.get_by_label('Department or teaching designation', exact=True)).to_have_value('Updated Faculty')
    admin_context = browser.new_context(viewport={'width': 375, 'height': 812})
    authenticate(admin_context, os.environ['CLASSROOM_ADMIN_COOKIE'])
    admin = admin_context.new_page()
    review_responses = []
    review_response_objects = []
    script_responses = []
    request_failures = []
    admin.on('response', lambda response: script_responses.append({'url': response.url, 'status': response.status}) if '/_next/' in response.url and response.request.resource_type == 'script' else None)
    admin.on('requestfailed', lambda request: request_failures.append({'url': request.url, 'failure': request.failure}))
    diagnostic_dir = Path('/tmp/classroom-overhaul-workspace-flight-' + os.environ.get('CLASSROOM_WORKSPACE_DIAGNOSTIC_NAME', 'normal'))
    diagnostic_dir.mkdir(parents=True, exist_ok=True)
    def capture_review_response(response):
        if '/class/admin/teachers/' not in response.url:
            return
        request_headers = response.request.all_headers()
        response_headers = response.all_headers()
        review_responses.append({'url': response.url, 'status': response.status, 'request': {key: request_headers.get(key) for key in ['rsc', 'next-router-state-tree', 'next-url', 'next-router-prefetch', 'purpose', 'sec-purpose', 'accept']}, 'response': {key: response_headers.get(key) for key in ['content-type', 'x-nextjs-redirect', 'x-nextjs-rewrite', 'x-nextjs-cache', 'cache-control', 'vary', 'location']}})
        review_response_objects.append(response)
    if os.environ.get('CLASSROOM_WORKSPACE_NO_PREFETCH') == 'true':
        def block_prefetch(route):
            headers = route.request.all_headers()
            if headers.get('next-router-prefetch') == '1' or 'prefetch' in headers.get('purpose', '') or 'prefetch' in headers.get('sec-purpose', ''):
                route.abort('blockedbyclient')
            else:
                route.continue_()
        admin.route('**/*', block_prefetch)
    review_errors = []
    review_console_errors = []
    admin.on('console', lambda message: review_console_errors.append(message.text) if message.type == 'error' else None)
    admin.on('pageerror', lambda error: review_errors.append(str(error)))
    admin.on('response', capture_review_response)
    admin.goto(base + '/class/admin/teachers')
    expect(admin.get_by_role('heading', name='Teacher access', exact=True)).to_be_visible()
    review_href = admin.get_by_role('link', name='Review application — Pending Teacher', exact=True).get_attribute('href')
    admin.get_by_role('link', name='Review application — Pending Teacher', exact=True).click()
    try:
        expect(admin.get_by_role('heading', name='Pending Teacher', exact=True)).to_be_visible()
    finally:
        for index, response in enumerate(review_response_objects):
            try:
                (diagnostic_dir / ('response-' + str(index) + '.txt')).write_text(response.text())
            except Exception as error:
                review_responses[index]['bodyError'] = str(error)
        direct = admin.request.get(base + review_href, headers={'accept': 'text/html'})
        (diagnostic_dir / 'direct.html').write_text(direct.text())
        direct_headers = direct.headers
        evidence = {'url': admin.url, 'expectedHref': review_href, 'prefetchDisabled': os.environ.get('CLASSROOM_WORKSPACE_NO_PREFETCH') == 'true', 'scriptResponses': script_responses, 'requestFailures': request_failures, 'responses': review_responses, 'errors': review_errors, 'consoleErrors': review_console_errors, 'history': admin.evaluate("({keys:Object.keys(window.history.state || {}),next:window.history.state?.__NA,tree:window.history.state?.__PRIVATE_NEXTJS_INTERNALS_TREE})"), 'direct': {'status': direct.status, 'url': direct.url, 'headers': {key: direct_headers.get(key) for key in ['content-type', 'x-nextjs-redirect', 'cache-control', 'location']}}}
        (diagnostic_dir / 'evidence.json').write_text(json.dumps(evidence, indent=2))
        print('Teacher review navigation evidence:', json.dumps({'url': admin.url, 'diagnosticDirectory': str(diagnostic_dir), 'responses': len(review_responses), 'errors': review_errors, 'consoleErrors': review_console_errors}))
    admin.get_by_role('button', name='Approve', exact=True).click()
    admin.get_by_role('button', name='Confirm approval', exact=True).click()
    expect(admin.get_by_role('dialog')).to_have_count(0)
    admin.goto(base + '/class/admin/teachers')
    expect(admin.get_by_text('No pending applications', exact=True)).to_be_visible()
    status.get_by_role('button', name='Check status', exact=True).click()
    status.get_by_role('link', name='Continue to Classroom →', exact=True).click()
    status.wait_for_url('**/class')
    expect(status.get_by_role('heading', name='Welcome, Pending', exact=True)).to_be_visible()
    # Approve the original teacher's separately requested Events access through the existing workflow.
    approval = Request(base + '/api/admin/organizers/' + os.environ['CLASSROOM_TEACHER_ID'], data=json.dumps({'action': 'APPROVE'}).encode(), method='PATCH', headers={'content-type': 'application/json', 'origin': base, 'cookie': os.environ['CLASSROOM_ADMIN_COOKIE']})
    with urlopen(approval) as response:
        assert response.status == 200
    view.evaluate("window.dispatchEvent(new Event('focus'))")
    view.get_by_role('button', name='Account menu for Teacher', exact=True).click()
    view.get_by_role('menuitem', name='Switch to Events', exact=True).click()
    view.wait_for_url('**/dashboard')
    # Shared actions and switcher contrast are checked in both explicit appearances.
    view.set_viewport_size({'width': 1920, 'height': 1080})
    expand = view.get_by_role('button', name='Expand sidebar', exact=True)
    if expand.is_visible():
        expand.click()
    switcher = view.get_by_role('button', name='Switch to Class', exact=True)
    expect(switcher).to_be_visible()
    view.wait_for_timeout(350) # Sidebar width transition must settle before control measurement.
    measurements = switcher.evaluate("""element => {
      const style = getComputedStyle(element), box = element.getBoundingClientRect();
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');
      const rgb=value=>{context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);return Array.from(context.getImageData(0,0,1,1).data).slice(0,3);};
      const lum = value => rgb(value).map(n => { const c=n/255; return c<=.04045?c/12.92:((c+.055)/1.055)**2.4; }).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
      const front=lum(style.color), back=lum(style.backgroundColor);
      return {height:box.height,fontSize:style.fontSize,color:style.color,background:style.backgroundColor,contrast:(Math.max(front,back)+.05)/(Math.min(front,back)+.05)};
    }""")
    assert measurements['height'] >= 48 and measurements['fontSize'] == '14px', measurements
    assert measurements['contrast'] >= 4.5, measurements
    assert view.locator('main').evaluate('element => element.getBoundingClientRect().width') <= 1280
    Path('.superpowers/classroom-tests').mkdir(parents=True, exist_ok=True)
    view.screenshot(path='.superpowers/classroom-tests/workspace-expanded-1920.png', full_page=True)
    view.get_by_role('button', name='Collapse sidebar', exact=True).click()
    expect(view.get_by_role('button', name='Expand sidebar', exact=True)).to_be_visible()
    expect(switcher).to_have_count(0)
    view.wait_for_timeout(350)
    no_overflow(view)
    view.screenshot(path='.superpowers/classroom-tests/workspace-collapsed-1920.png', full_page=True)
    view.set_viewport_size({'width':375,'height':812})
    view.get_by_role('button', name='Account menu for Teacher', exact=True).click()
    light_switcher=view.get_by_role('menuitem', name='Switch to Class', exact=True)
    expect(light_switcher).to_be_visible()
    expect(light_switcher).to_have_css('min-height','48px')
    view.wait_for_timeout(250) # Radix opening scale animation must settle before target measurement.
    light=light_switcher.evaluate("""element => {
      let ancestor=element, background='';
      while(ancestor){const value=getComputedStyle(ancestor).backgroundColor;if(value!=='rgba(0, 0, 0, 0)'&&value!=='transparent'){background=value;break;}ancestor=ancestor.parentElement;}
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');
      const rgb=value=>{context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);return Array.from(context.getImageData(0,0,1,1).data).slice(0,3);};
      const lum=value=>rgb(value).map(n=>{const c=n/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
      const color=getComputedStyle(element).color,front=lum(color),back=lum(background);
      return {color,background,height:element.getBoundingClientRect().height,contrast:(Math.max(front,back)+.05)/(Math.min(front,back)+.05)};
    }""")
    assert light['height'] >= 48, light
    assert light['contrast'] >= 4.5, light
    assert light['color'] not in ['rgb(255, 255, 255)','rgba(255, 255, 255, 1)'], light
    no_overflow(view)
    view.screenshot(path='.superpowers/classroom-tests/workspace-menu-375.png', full_page=True)
    view.keyboard.press('Escape')
    print('Shared switcher measurements:',json.dumps({'dark':measurements,'light':light}))
    admin.get_by_role('navigation', name='Teacher access status', exact=True).get_by_role('link', name='Approved', exact=True).click()
    admin.get_by_role('link', name='Review application — Teacher', exact=True).click()
    expect(admin.get_by_role('heading', name='Teacher', exact=True)).to_be_visible()
    admin.get_by_role('button', name='Suspend Class access', exact=True).click()
    admin.get_by_label('Reason', exact=True).fill('Workspace isolation test')
    admin.get_by_role('button', name='Confirm suspension', exact=True).click()
    expect(admin.get_by_role('dialog')).to_have_count(0)
    view.goto(base + '/dashboard')
    assert '/dashboard' in view.url, 'Class suspension must preserve Events access'
    view.goto(base + '/class')
    view.wait_for_url('**/class/access')
    expect(view.get_by_role('heading', name='Class access suspended', exact=True)).to_be_visible()
    expect(view.get_by_role('link', name='Open Events →', exact=True)).to_be_visible()
    no_overflow(admin)
    no_overflow(status)
    Path('.superpowers/classroom-tests').mkdir(parents=True, exist_ok=True)
    status.screenshot(path='.superpowers/classroom-tests/workspace-375.png', full_page=True)
    browser.close()
print('PASS mobile Class selector/navigation, Events shell rejection, pending-to-approved teacher, dual workspace switch, independent suspension and 375px overflow checks.')
