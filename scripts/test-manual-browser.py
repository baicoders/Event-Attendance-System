"""Optional browser check, called with MANUAL_BROWSER_TEST=1 node scripts/test-operator-api.mjs."""

import json
import sys
import time

from playwright.sync_api import sync_playwright, expect


base, event_id, email = sys.argv[1:4]
student_id = "00000000009"


def login(page):
    page.goto(base + "/login")
    page.get_by_label("Email").fill(email)
    page.get_by_label("Password").fill("password-123")
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url("**/dashboard")
    page.goto(base + "/attendance?eventId=" + event_id)
    page.wait_for_load_state("networkidle")
    expect(page.get_by_label("Search name or student ID")).to_be_visible()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True, executable_path="/usr/bin/google-chrome", args=["--no-sandbox"]
    )
    desktop = browser.new_page(viewport={"width": 1280, "height": 900})
    writes = []
    roster_requests = []
    roster_responses = []
    desktop.on("request", lambda request: writes.append(json.loads(request.post_data))
               if request.method == "POST" and request.url.endswith("/api/records") else None)
    desktop.on("request", lambda request: roster_requests.append(time.perf_counter())
               if request.method == "GET" and "/api/students?eventId=" in request.url else None)
    desktop.on("response", lambda response: roster_responses.append((time.perf_counter(), response))
               if response.request.method == "GET" and "/api/students?eventId=" in response.url else None)
    login(desktop)
    assert len(roster_requests) == 1, "Manual entry should load one event roster"
    assert len(roster_responses) == 1
    roster_ms = round((roster_responses[0][0] - roster_requests[0]) * 1000)
    payload_bytes = len(roster_responses[0][1].body())
    desktop.route("**/api/records?*", lambda route: route.fulfill(
        status=503, content_type="application/json",
        body=json.dumps({"success": False, "message": "Read unavailable"})
    ) if route.request.method == "GET" else route.continue_())

    search = desktop.get_by_label("Search name or student ID")
    with desktop.expect_response(lambda response: "/api/students?eventId=" in response.url):
        search.fill("0")
    desktop.wait_for_load_state("networkidle")
    expect(desktop.get_by_text("Enter two or more characters to find a student.")).to_be_visible()
    before_warm_queries = len(roster_requests)
    samples = []
    for number in range(20, 45):
        code = str(number).zfill(11)
        start = time.perf_counter()
        search.fill(code)
        expect(desktop.get_by_role("button", name="Record time in for Test Student " + str(number - 1) + ", " + code)).to_be_visible()
        samples.append((time.perf_counter() - start) * 1000)
    assert len(roster_requests) == before_warm_queries, "typing caused another roster request"
    p95_ms = round(sorted(samples)[int(len(samples) * 0.95) - 1])
    search.fill(student_id)
    row_action = desktop.get_by_role("button", name="Record time in for Test Student 8, " + student_id)
    expect(row_action).to_be_visible()
    search.press("Escape")
    expect(desktop.get_by_text("Results closed. Focus search to show them again.")).to_be_visible()
    expect(row_action).not_to_be_visible()
    search.focus()
    expect(row_action).to_be_visible()
    search.press("Enter")
    assert writes == [], "Enter in search wrote attendance"
    search.press("ArrowDown")
    assert desktop.evaluate("document.activeElement.getAttribute('aria-label')") == \
        "View details for Test Student 8, " + student_id
    desktop.keyboard.press("Enter")
    expect(desktop.get_by_text("Attendance status could not be checked. Status is unknown.")).to_be_visible()
    assert writes == [], "Viewing details wrote attendance"
    row_action.click()
    expect(desktop.get_by_text("Time-in recorded", exact=True)).to_be_visible()
    assert len(writes) == 1, writes
    assert writes[0]["studentId"] == student_id
    assert writes[0]["method"] == "MANUAL"
    assert writes[0]["expectedMode"] == "TIME_IN"
    desktop.get_by_role("button", name="Next student").click()
    assert search.input_value() == ""
    assert desktop.evaluate("document.activeElement.id") == "manual-attendance-search"
    desktop.screenshot(path="/tmp/issue-71-desktop.png", full_page=True)

    removed_id = "00000000012"
    search.fill(removed_id)
    stale_action = desktop.get_by_role("button", name="Record time in for Test Student 11, " + removed_id)
    expect(stale_action).to_be_visible()
    removed = desktop.evaluate("""async (url) => {
        const response = await fetch(url, { method: 'DELETE' });
        return { ok: response.ok, body: await response.text() };
    }""", base + "/api/students/" + removed_id)
    assert removed["ok"], removed["body"]
    before_rejection = len(roster_requests)
    stale_action.click()
    expect(desktop.get_by_text("No matching students in this event.")).to_be_visible()
    assert len(roster_requests) > before_rejection, "eligibility rejection did not refresh roster"

    desktop.goto(base + "/attendance/operator?eventId=" + event_id)
    desktop.wait_for_load_state("networkidle")
    with desktop.expect_response(lambda response: "/api/students?eventId=" in response.url):
        desktop.get_by_role("button", name="Manual entry").click()
    sheet = desktop.get_by_role("dialog")
    expect(sheet).to_be_visible()
    sheet_search = sheet.get_by_label("Search name or student ID")
    expect(sheet_search).to_be_focused()
    sheet_search.fill("00000000011")
    sheet.get_by_role("button", name="Record time in for Test Student 10, 00000000011").click()
    expect(sheet.get_by_text("Time-in recorded", exact=True)).to_be_visible()
    assert writes[-1]["method"] == "MANUAL" and writes[-1]["expectedMode"] == "TIME_IN"
    sheet.get_by_role("button", name="Next student").click()
    assert sheet_search.input_value() == ""
    sheet.get_by_role("button", name="Return to scanner").click()
    expect(sheet).not_to_be_visible()
    before_reopen = len(roster_requests)
    with desktop.expect_response(lambda response: "/api/students?eventId=" in response.url):
        desktop.get_by_role("button", name="Manual entry").click()
    assert len(roster_requests) > before_reopen, "reopening operator Sheet did not refresh roster"
    desktop.get_by_role("dialog").get_by_role("button", name="Return to scanner").click()

    scope_calls = {"count": 0}

    def change_observed_scope(route):
        response = route.fetch()
        body = response.json()
        scope_calls["count"] += 1
        if scope_calls["count"] > 1:
            body["data"]["category"] = "SHS"
        route.fulfill(response=response, body=json.dumps(body))

    desktop.route("**/api/events/" + event_id, change_observed_scope)
    desktop.goto(base + "/attendance?eventId=" + event_id)
    desktop.wait_for_load_state("networkidle")
    before_scope_change = len(roster_requests)
    with desktop.expect_response(lambda response: "/api/students?eventId=" in response.url, timeout=15000):
        desktop.wait_for_timeout(10000)
    assert scope_calls["count"] > 1, "live event poll did not observe a changed audience"
    assert len(roster_requests) > before_scope_change, "observed audience change did not refresh roster"

    mobile = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    mobile_record_responses = []
    mobile.on("response", lambda response: mobile_record_responses.append((response.status, response.url))
              if response.request.method == "POST" and response.url.endswith("/api/records") else None)
    login(mobile)
    mobile_search = mobile.get_by_label("Search name or student ID")
    mobile_search.fill("00000000010")
    mobile_action = mobile.get_by_role("button", name="Record time in for Test Student 9, 00000000010")
    expect(mobile_action).to_be_visible()
    assert mobile.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 2"), "mobile page overflows horizontally"
    mobile_action.tap()
    try:
        expect(mobile.get_by_text("Time-in recorded", exact=True)).to_be_visible(timeout=10000)
    except AssertionError:
        print("Mobile manual panel: " + mobile.locator('section[aria-label="Manual attendance"]').inner_text())
        print("Mobile record responses: " + repr(mobile_record_responses))
        raise
    mobile.screenshot(path="/tmp/issue-71-mobile.png", full_page=True)
    print("Manual browser checks passed: keyboard selection cannot write, failed status is unknown, explicit row write carries MANUAL + expectedMode, next student restores focus, eligibility rejection and observed scope changes refresh roster, operator Sheet reopening refreshes roster, mobile tap records.")
    print("Chrome headless, 2,000 students: cold roster HTTP " + str(roster_ms) + " ms, " + str(payload_bytes) + " response bytes, 1 initial roster GET; warm input-to-row p95 " + str(p95_ms) + " ms across 25 exact-ID queries (includes Playwright overhead).")
    browser.close()
