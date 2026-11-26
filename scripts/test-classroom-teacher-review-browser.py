import json
import os
import shutil
import traceback
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

expect.set_options(timeout=10000)
base = os.environ['CLASSROOM_TEST_BASE']
fixtures = json.loads(os.environ['CLASSROOM_TEACHER_REVIEW_FIXTURES'])
artifacts = Path('.superpowers/classroom-tests/teacher-review')
artifacts.mkdir(parents=True, exist_ok=True)
results = []


def check(label, callback):
    try:
        callback()
        results.append({'label': label, 'passed': True})
        print('PASS ' + label, flush=True)
    except Exception as error:
        results.append({'label': label, 'passed': False, 'error': str(error), 'trace': traceback.format_exc()})
        print('FAIL ' + label + ': ' + str(error), flush=True)


def no_overflow(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal page overflow'


def authenticate(browser, key, width=375):
    context = browser.new_context(viewport={'width': width, 'height': 900})
    name, value = fixtures[key]['cookie'].split('=', 1)
    context.add_cookies([{'name': name, 'value': value, 'url': base, 'httpOnly': True, 'sameSite': 'Lax', 'secure': False}])
    page = context.new_page()
    page.set_default_timeout(10000)
    page.set_default_navigation_timeout(20000)
    return context, page


def membership(context, key):
    response = context.request.get(base + '/api/admin/classroom/teachers/' + fixtures[key]['id'])
    assert response.status == 200
    return response.json()['data']['membership']


labels = {'APPROVE': 'Approve', 'REJECT': 'Reject', 'SUSPEND': 'Suspend Class access', 'REVOKE': 'Revoke Class access', 'RESTORE': 'Restore Class access'}
confirmations = {'APPROVE': 'Confirm approval', 'REJECT': 'Confirm rejection', 'SUSPEND': 'Confirm suspension', 'REVOKE': 'Confirm revocation', 'RESTORE': 'Confirm restoration'}
allowed = {'PENDING': ['APPROVE', 'REJECT'], 'APPROVED': ['SUSPEND', 'REVOKE'], 'REJECTED': [], 'SUSPENDED': ['RESTORE', 'REVOKE'], 'REVOKED': ['RESTORE']}


def open_detail(page, key):
    page.goto(base + '/class/admin/teachers/' + fixtures[key]['id'])
    expect(page.get_by_role('heading', name=fixtures[key]['name'], exact=True)).to_be_visible()
    expect(page.get_by_role('heading', name='Teacher application', exact=True)).to_be_visible()


def expect_allowed(page, state):
    for action, label in labels.items():
        expect(page.get_by_role('button', name=label, exact=True)).to_have_count(1 if action in allowed[state] else 0)


def keyboard_dialog(page, action):
    trigger = page.get_by_role('button', name=labels[action], exact=True)
    trigger.focus()
    page.keyboard.press('Enter')
    dialog = page.get_by_role('dialog')
    expect(dialog).to_be_visible()
    assert dialog.evaluate('element => element.contains(document.activeElement)'), 'Opening a decision must move focus into its dialog'
    for _ in range(8):
        page.keyboard.press('Tab')
        assert dialog.evaluate('element => element.contains(document.activeElement)'), 'Dialog focus escaped while tabbing'
    page.keyboard.press('Escape')
    expect(dialog).to_have_count(0)
    try:
        expect(trigger).to_be_focused()
    except Exception as cause:
        focused = page.evaluate("({tag:document.activeElement?.tagName,role:document.activeElement?.getAttribute('role'),label:document.activeElement?.getAttribute('aria-label')})")
        raise AssertionError('Dialog close did not restore focus to '+labels[action]+'; focused='+json.dumps(focused)) from cause


def decision(context, page, key, action, expected, reason=None):
    page.get_by_role('button', name=labels[action], exact=True).click()
    dialog = page.get_by_role('dialog')
    expect(dialog.get_by_role('heading', name=labels[action], exact=True)).to_be_visible()
    field = dialog.get_by_role('textbox', name='Reason' if action != 'APPROVE' else 'Reason (optional)', exact=True)
    if action != 'APPROVE':
        expect(field).to_have_attribute('required', '')
        before = membership(context, key)
        dialog.get_by_role('button', name=confirmations[action], exact=True).click()
        expect(dialog).to_be_visible()
        assert field.evaluate('element => !element.validity.valid'), 'An empty decision reason must be invalid'
        assert membership(context, key)['revision'] == before['revision'], 'Blank reason changed membership'
    if reason:
        field.fill(reason)
    no_overflow(page)
    with page.expect_response(lambda response: response.request.method == 'PATCH' and '/api/admin/classroom/teachers/' in response.url) as saved:
        dialog.get_by_role('button', name=confirmations[action], exact=True).click()
    assert saved.value.status == 200, saved.value.text()
    expect(dialog).to_have_count(0)
    assert membership(context, key)['status'] == expected
    expect_allowed(page, expected)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=shutil.which('google-chrome') or '/opt/google/chrome/chrome', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage', '--renderer-process-limit=2'])
    admin_context, admin = authenticate(browser, 'admin')

    def access_states():
        titles = {'first': 'Apply for teacher access', 'pending': 'Teacher access pending', 'approved': 'Teacher access approved', 'rejected': 'Update your teacher application', 'suspended': 'Class access suspended', 'revoked': 'Class access revoked'}
        for key, title in titles.items():
            context, page = authenticate(browser, key)
            for width in [375, 1440]:
                page.set_viewport_size({'width': width, 'height': 900})
                page.goto(base + '/class/access')
                expect(page.get_by_role('heading', name=title, exact=True)).to_be_visible()
                editable = key in ['first', 'pending', 'rejected']
                expect(page.get_by_role('textbox', name='Department or teaching designation', exact=True)).to_have_count(1 if editable else 0)
                if key not in ['first', 'pending']:
                    expect(page.get_by_text('Fixture reason for ' + key, exact=True)).to_be_visible()
                if key == 'approved':
                    expect(page.get_by_role('link', name='Continue to Classroom →', exact=True)).to_be_visible()
                if key in ['suspended', 'revoked']:
                    expect(page.get_by_role('button', name='Submit application', exact=True)).to_have_count(0)
                    expect(page.get_by_role('button', name='Resubmit application', exact=True)).to_have_count(0)
                no_overflow(page)
            page.screenshot(path=str(artifacts / (key + '-access-1440.png')), full_page=True)
            context.close()
    check('first application and all five access states render correctly at 375px and 1440px', access_states)

    def pending_list():
        for width in [375, 1440]:
            admin.set_viewport_size({'width': width, 'height': 900})
            admin.goto(base + '/class/admin/teachers')
            nav = admin.get_by_role('navigation', name='Teacher access status', exact=True)
            expect(nav.get_by_role('link', name='Pending', exact=True)).to_have_attribute('aria-current', 'page')
            expect(admin.get_by_role('heading', name='Applications to review', exact=True)).to_be_visible()
            for key in ['pending', 'reject', 'stale', 'uncertain']:
                row = admin.get_by_role('listitem').filter(has=admin.get_by_text(fixtures[key]['name'], exact=True))
                expect(row.get_by_role('link', name='Review application — ' + fixtures[key]['name'], exact=True)).to_have_count(1)
                expect(row.get_by_role('button')).to_have_count(0)
            expect(admin.get_by_role('button', name='Approve', exact=True)).to_have_count(0)
            expect(admin.get_by_text(fixtures['approved']['name'], exact=True)).to_have_count(0)
            no_overflow(admin)
        admin.get_by_role('link', name='Review application — ' + fixtures['pending']['name'], exact=True).focus()
        admin.keyboard.press('Enter')
        expect(admin.get_by_role('heading', name=fixtures['pending']['name'], exact=True)).to_be_visible()
        expect_allowed(admin, 'PENDING')
        admin.screenshot(path=str(artifacts / 'teacher-detail-1440.png'), full_page=True)
    check('pending-first list provides one Review entry per teacher and keyboard opens teacher detail', pending_list)

    for width in [375, 1440]:
        def keyboard_review(width=width):
            open_detail(admin, 'pending')
            admin.set_viewport_size({'width': width, 'height': 900})
            keyboard_dialog(admin, 'APPROVE')
            no_overflow(admin)
        check('decision dialog keyboard focus enters traps and restores at '+str(width)+'px', keyboard_review)

    def access_decisions():
        admin.set_viewport_size({'width': 375, 'height': 900})
        open_detail(admin, 'pending')
        decision(admin_context, admin, 'pending', 'APPROVE', 'APPROVED')
        decision(admin_context, admin, 'pending', 'SUSPEND', 'SUSPENDED', 'Reviewed suspension for teaching reassignment')
        decision(admin_context, admin, 'pending', 'RESTORE', 'APPROVED', 'Teacher cleared to return to class')
        decision(admin_context, admin, 'pending', 'REVOKE', 'REVOKED', 'Teacher assignment ended after review')
        decision(admin_context, admin, 'pending', 'RESTORE', 'APPROVED', 'Teaching assignment renewed')
        no_overflow(admin)
        admin.screenshot(path=str(artifacts / 'teacher-decisions-375.png'), full_page=True)
    check('approve suspend restore revoke restore honor allowed actions and require reasons', access_decisions)

    def rejection():
        open_detail(admin, 'reject')
        decision(admin_context, admin, 'reject', 'REJECT', 'REJECTED', 'Please provide your current department assignment')
        context, page = authenticate(browser, 'reject')
        page.goto(base + '/class/access')
        expect(page.get_by_role('heading', name='Update your teacher application', exact=True)).to_be_visible()
        expect(page.get_by_text('Please provide your current department assignment', exact=True)).to_be_visible()
        page.get_by_role('textbox', name='Department or teaching designation', exact=True).fill('Updated Science Faculty')
        page.get_by_role('button', name='Resubmit application', exact=True).click()
        expect(page.get_by_role('heading', name='Teacher access pending', exact=True)).to_be_visible()
        no_overflow(page)
        context.close()
    check('rejection is visible to the teacher and permits corrected resubmission', rejection)

    def stale_revision():
        open_detail(admin, 'stale')
        admin.get_by_role('button', name='Approve', exact=True).click()
        dialog = admin.get_by_role('dialog')
        current = membership(admin_context, 'stale')
        response = admin_context.request.patch(base + '/api/admin/classroom/teachers/' + fixtures['stale']['id'], headers={'origin': base}, data={'commandId': admin.evaluate('crypto.randomUUID()'), 'expectedRevision': current['revision'], 'action': 'REJECT', 'reason': 'Newer administrator rejection'})
        assert response.status == 200, response.text()
        with admin.expect_response(lambda response: response.request.method == 'PATCH' and '/api/admin/classroom/teachers/' in response.url) as failed:
            dialog.get_by_role('button', name='Confirm approval', exact=True).click()
        assert failed.value.status == 409
        expect(dialog.get_by_role('alert')).to_contain_text('Application changed. Reload before reviewing.')
        assert membership(admin_context, 'stale')['status'] == 'REJECTED'
        dialog.get_by_role('button', name='Reload teacher application', exact=True).click()
        expect(dialog).to_have_count(0)
        expect_allowed(admin, 'REJECTED')
        expect(admin.get_by_text('The teacher can update and resubmit their application.', exact=True)).to_be_visible()
    check('stale revision fails safely and reload exposes the newer decision', stale_revision)

    def uncertain_review():
        open_detail(admin, 'uncertain')
        admin.get_by_role('button', name='Approve', exact=True).click()
        dialog = admin.get_by_role('dialog')
        dialog.get_by_role('textbox', name='Reason (optional)', exact=True).fill('Verified application with lost acknowledgement')
        payloads = []
        path = base + '/api/admin/classroom/teachers/' + fixtures['uncertain']['id']
        def lose_ack(route):
            if route.request.method == 'PATCH':
                payloads.append(route.request.post_data_json)
                response = route.fetch()
                assert response.status == 200
                route.abort()
            else:
                route.continue_()
        admin.route(path, lose_ack)
        dialog.get_by_role('button', name='Confirm approval', exact=True).click()
        expect(dialog.get_by_role('alert')).to_contain_text('Decision not confirmed')
        assert membership(admin_context, 'uncertain')['status'] == 'APPROVED'
        admin.unroute(path, lose_ack)
        with admin.expect_response(lambda response: response.request.method == 'PATCH' and response.url == path) as replay:
            dialog.get_by_role('button', name='Confirm approval', exact=True).click()
        assert replay.value.status == 200
        payloads.append(replay.value.request.post_data_json)
        assert payloads[0] == payloads[1], 'Retry changed command ID, revision, or decision payload'
        assert replay.value.json()['data']['replayed'] is True
        expect(dialog).to_have_count(0)
        expect_allowed(admin, 'APPROVED')
    check('lost decision acknowledgement retries the identical request and replays one review', uncertain_review)

    def first_application():
        context, page = authenticate(browser, 'first')
        page.goto(base + '/class/access')
        page.get_by_role('button', name='Submit application', exact=True).click()
        expect(page.get_by_role('alert').filter(has_text='Application save not confirmed')).to_contain_text('Enter your teaching designation.')
        page.get_by_role('textbox', name='Department or teaching designation', exact=True).fill('First-time Science Faculty')
        page.get_by_role('textbox', name='Staff reference (optional)', exact=True).fill('NEW-STAFF-01')
        page.get_by_role('textbox', name='Application information (optional)', exact=True).fill('Please review my teaching assignment.')
        payloads = []
        path = base + '/api/classroom/application'
        def lose_ack(route):
            if route.request.method == 'PUT':
                payloads.append(route.request.post_data_json)
                response = route.fetch()
                assert response.status == 200
                route.abort()
            else:
                route.continue_()
        page.route(path, lose_ack)
        page.get_by_role('button', name='Submit application', exact=True).click()
        expect(page.get_by_role('alert').filter(has_text='Application save not confirmed')).to_be_visible()
        page.unroute(path, lose_ack)
        with page.expect_response(lambda response: response.request.method == 'PUT' and response.url == path) as replay:
            page.get_by_role('button', name='Submit application', exact=True).click()
        assert replay.value.status == 200
        payloads.append(replay.value.request.post_data_json)
        assert payloads[0] == payloads[1], 'Application retry must keep its original command'
        assert replay.value.json()['data']['replayed'] is True
        expect(page.get_by_role('heading', name='Teacher access pending', exact=True)).to_be_visible()
        page.reload()
        expect(page.get_by_role('textbox', name='Department or teaching designation', exact=True)).to_have_value('First-time Science Faculty')
        no_overflow(page)
        context.close()
    check('first application validates details and survives uncertain acknowledgement without duplicate submission', first_application)
    browser.close()

Path(os.environ['CLASSROOM_TEACHER_REVIEW_RESULT']).write_text(json.dumps(results, indent=2))
print(json.dumps(results, indent=2), flush=True)
raise SystemExit(0 if all(result['passed'] for result in results) else 1)
