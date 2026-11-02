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
    expect(view.get_by_role('heading', name='My Classes', exact=True)).to_be_visible()
    expect(view.get_by_role('navigation', name='Primary').get_by_role('link', name='Classes', exact=True)).to_be_visible()
    expect(view.get_by_role('link', name='Calendar', exact=True)).to_have_count(0)
    no_overflow(view)
    view.goto(base + '/dashboard')
    view.wait_for_url('**/class')
    expect(view.get_by_role('heading', name='My Classes', exact=True)).to_be_visible()
    view.goto(base + '/class/settings')
    expect(view.get_by_role('heading', name='Profile / Settings', exact=True)).to_be_visible()
    no_overflow(view)
    view.route('**/api/auth/session', lambda route: route.abort())
    view.evaluate("window.dispatchEvent(new Event('focus'))")
    expect(view.get_by_text('Connection unavailable.', exact=False)).to_be_visible()
    view.unroute('**/api/auth/session')
    view.get_by_role('button', name='Retry connection', exact=True).click()
    expect(view.get_by_role('heading', name='Profile / Settings', exact=True)).to_be_visible()
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
    admin.goto(base + '/class/admin/teachers')
    expect(admin.get_by_role('heading', name='Teacher Access', exact=True)).to_be_visible()
    admin.get_by_role('button', name='Approve', exact=True).click()
    admin.get_by_role('button', name='Confirm approval', exact=True).click()
    expect(admin.get_by_text('No teacher applications match this status.')).to_be_visible()
    status.get_by_role('button', name='Check status', exact=True).click()
    status.get_by_role('link', name='Continue to Class', exact=True).click()
    status.wait_for_url('**/class')
    expect(status.get_by_role('heading', name='My Classes', exact=True)).to_be_visible()
    # Approve the original teacher's separately requested Events access through the existing workflow.
    approval = Request(base + '/api/admin/organizers/' + os.environ['CLASSROOM_TEACHER_ID'], data=json.dumps({'action': 'APPROVE'}).encode(), method='PATCH', headers={'content-type': 'application/json', 'origin': base, 'cookie': os.environ['CLASSROOM_ADMIN_COOKIE']})
    with urlopen(approval) as response:
        assert response.status == 200
    view.evaluate("window.dispatchEvent(new Event('focus'))")
    view.get_by_role('button', name='Account menu for Teacher', exact=True).click()
    view.get_by_role('menuitem', name='Switch to Events', exact=True).click()
    view.wait_for_url('**/dashboard')
    admin.get_by_label('Teacher access status', exact=True).select_option('APPROVED')
    card = admin.locator('article').filter(has=admin.get_by_role('heading', name='Teacher', exact=True))
    card.get_by_role('button', name='Suspend Class access', exact=True).click()
    admin.get_by_label('Reason', exact=True).fill('Workspace isolation test')
    admin.get_by_role('button', name='Confirm suspension', exact=True).click()
    expect(admin.get_by_role('dialog')).to_have_count(0)
    view.goto(base + '/dashboard')
    assert '/dashboard' in view.url, 'Class suspension must preserve Events access'
    view.goto(base + '/class')
    view.wait_for_url('**/class/access')
    expect(view.get_by_role('heading', name='Class access suspended', exact=True)).to_be_visible()
    expect(view.get_by_role('link', name='Open Events', exact=True)).to_be_visible()
    no_overflow(admin)
    no_overflow(status)
    Path('.superpowers/classroom-tests').mkdir(parents=True, exist_ok=True)
    status.screenshot(path='.superpowers/classroom-tests/workspace-375.png', full_page=True)
    browser.close()
print('PASS mobile Class selector/navigation, Events shell rejection, pending-to-approved teacher, dual workspace switch, independent suspension and 375px overflow checks.')
