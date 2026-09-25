"""Smoke-check issue #69 against a disposable DB seeded with prisma/seed.ts."""

import hashlib
import json
import os
import sqlite3
import subprocess

BASE = os.environ.get('READINESS_BASE_URL', 'http://localhost:3109')
DB = os.environ.get('READINESS_DB', '/tmp/event-readiness-issue-69.db')

def request(path, method='GET', payload=None, cookie=None):
    args = ['curl', '-sS', '-w', '\n%{http_code}', '-X', method]
    if cookie:
        args += ['-b', cookie]
    if payload is not None:
        args += ['-H', 'Content-Type: application/json', '-d', json.dumps(payload)]
    args += [BASE + path]
    body, status = subprocess.check_output(args, text=True).rsplit('\n', 1)
    return int(status), json.loads(body)

def login(email, cookie):
    args = ['curl', '-sS', '-c', cookie, '-H', 'Content-Type: application/json',
            '-d', json.dumps({'email': email, 'password': 'password'}), BASE + '/api/auth/login']
    result = json.loads(subprocess.check_output(args, text=True))
    assert result['success'], result
    return result['data']

def digest_business_rows():
    con = sqlite3.connect(DB)
    tables = ['Event', 'Student', 'User', 'Group', 'Record', '_EventGroups', '_GroupStudents']
    parts = []
    for table in tables:
        try:
            parts.append((table, con.execute(f'SELECT * FROM "{table}" ORDER BY 1').fetchall()))
        except sqlite3.OperationalError:
            pass
    con.close()
    return hashlib.sha256(repr(parts).encode()).hexdigest()

admin = login('admin@gmail.com', '/tmp/readiness-admin.cookies')
organizer = login('organizer@example.com', '/tmp/readiness-organizer.cookies')
status, events_response = request('/api/events', cookie='/tmp/readiness-admin.cookies')
assert status == 200
categories = {event['category'] for event in events_response['data']}
for category in ['ALL', 'COLLEGE', 'SHS', 'DEPARTMENT', 'HOUSE', 'STRAND', 'PROGRAM', 'SECTION', 'YEAR']:
    if category in categories:
        continue
    con = sqlite3.connect(DB)
    groups = [row[0] for row in con.execute('SELECT id FROM "Group" WHERE category = ? ORDER BY id LIMIT 2', (category,))]
    con.close()
    payload = {'title': f'{category} readiness fixture', 'category': category,
               'includedGroups': [] if category in ('ALL', 'COLLEGE', 'SHS') else groups,
               'start': '2026-09-28T00:00:00.000Z', 'end': '2026-09-28T04:00:00.000Z',
               'allDay': False, 'location': None, 'description': None}
    status, created = request('/api/events', 'POST', payload, '/tmp/readiness-admin.cookies')
    assert status == 201, (status, created)
status, events_response = request('/api/events', cookie='/tmp/readiness-admin.cookies')
admin_approved_payload = {'title': 'Admin-owned approved readiness fixture', 'category': 'ALL',
                          'includedGroups': [], 'start': '2026-09-28T00:00:00.000Z',
                          'end': '2026-09-28T04:00:00.000Z', 'allDay': False,
                          'location': None, 'description': None}
status, admin_owned = request('/api/events', 'POST', admin_approved_payload, '/tmp/readiness-admin.cookies')
assert status == 201, (status, admin_owned)
admin_owned_id = admin_owned['data']['id']
status, submitted = request(f'/api/events/{admin_owned_id}', 'PATCH', {'action': 'SUBMIT'},
                            '/tmp/readiness-admin.cookies')
assert status == 200 and submitted['data']['status'] == 'PENDING'
status, approved = request(f'/api/events/{admin_owned_id}', 'PATCH', {'action': 'APPROVE'},
                           '/tmp/readiness-admin.cookies')
assert status == 200 and approved['data']['status'] == 'APPROVED'
status, events_response = request('/api/events', cookie='/tmp/readiness-admin.cookies')
before = digest_business_rows()
checked = 0
for event in events_response['data']:
    status, readiness = request(f'/api/events/{event["id"]}/readiness', cookie='/tmp/readiness-admin.cookies')
    assert status == 200, (status, readiness)
    data = readiness['data']
    status, preview = request('/api/events/audience-preview', 'POST', {
        'category': event['category'], 'includedGroups': [g['id'] for g in event['includedGroups']],
        'page': 1, 'pageSize': 10, 'includeRoster': False,
    }, '/tmp/readiness-admin.cookies')
    assert status == 200, (event['category'], status, preview)
    assert data['eligibleCount'] == preview['data']['totalEligible'], event['category']
    assert 'password' not in json.dumps(data).lower()
    assert 'email' not in json.dumps(data).lower()
    checked += 1
assert before == digest_business_rows(), 'readiness changed business rows'
status, anon = request(f'/api/events/{events_response["data"][0]["id"]}/readiness')
assert status == 401, (status, anon)
status, shared = request(f'/api/events/{events_response["data"][0]["id"]}/readiness', cookie='/tmp/readiness-organizer.cookies')
assert status == 200 and shared['data']['recordingAllowed']
assert shared['data']['canManageMode'] == (events_response['data'][0]['createdById'] == organizer['id'])
status, nonowner_shared = request(f'/api/events/{admin_owned_id}/readiness',
                                  cookie='/tmp/readiness-organizer.cookies')
assert status == 200 and nonowner_shared['data']['recordingAllowed']
assert not nonowner_shared['data']['canManageMode']
status, toggled = request(f'/api/events/{admin_owned_id}/timeout', 'POST', {'isTimeout': True},
                          '/tmp/readiness-admin.cookies')
assert status == 200, (status, toggled)
status, time_out = request(f'/api/events/{admin_owned_id}/readiness', cookie='/tmp/readiness-admin.cookies')
assert status == 200 and time_out['data']['recordingMode'] == 'TIME_OUT'
assert 'prior time-in' in time_out['data']['checks'][-1]['detail']

payload = {'title':'Private readiness fixture','category':'ALL','includedGroups':[],
           'start':'2026-09-28T00:00:00.000Z','end':'2026-09-28T04:00:00.000Z',
           'allDay':False,'location':None,'description':None}
status, created = request('/api/events', 'POST', payload, '/tmp/readiness-admin.cookies')
assert status == 201, (status, created)
private_id = created['data']['id']
status, private = request(f'/api/events/{private_id}/readiness', cookie='/tmp/readiness-organizer.cookies')
assert status == 403, (status, private)
status, own_draft = request(f'/api/events/{private_id}/readiness', cookie='/tmp/readiness-admin.cookies')
assert status == 200 and own_draft['data']['summary'] == 'NOT_APPROVED'
status, organizer_draft = request('/api/events', 'POST', payload, '/tmp/readiness-organizer.cookies')
assert status == 201, (status, organizer_draft)
organizer_draft_id = organizer_draft['data']['id']
status, submitted = request(f'/api/events/{organizer_draft_id}', 'PATCH', {'action': 'SUBMIT'},
                            '/tmp/readiness-organizer.cookies')
assert status == 200 and submitted['data']['status'] == 'PENDING'
status, own_pending = request(f'/api/events/{organizer_draft_id}/readiness',
                              cookie='/tmp/readiness-organizer.cookies')
assert status == 200 and own_pending['data']['summary'] == 'NOT_APPROVED'
status, other_pending = request(f'/api/events/{organizer_draft_id}/readiness',
                                cookie='/tmp/readiness-admin.cookies')
assert status == 200  # Admin can inspect an organizer's pending event.
con = sqlite3.connect(DB)
con.execute('UPDATE "User" SET status = ? WHERE id = ?', ('REJECTED', organizer['id']))
con.commit()
status, inactive = request(f'/api/events/{admin_owned_id}/readiness',
                           cookie='/tmp/readiness-organizer.cookies')
con.execute('UPDATE "User" SET status = ? WHERE id = ?', ('ACTIVE', organizer['id']))
con.commit()
con.close()
assert status == 403, (status, inactive)
print(f'PASS: {checked} event counts match Audience Preview across all categories; reads unchanged; anonymous 401 and inactive 403; shared approved 200 without mode control; private draft 403; owner/admin pending 200; time-out explained; no owner secrets')
