"""Two-session desktop and mobile check for the disposable progress API fixture."""

import sys
from playwright.sync_api import sync_playwright, expect

base, event_id, owner_email, viewer_email = sys.argv[1:5]


def login(page, email):
    page.goto(base + "/login", wait_until="domcontentloaded", timeout=60000)
    page.get_by_label("Email").fill(email)
    page.get_by_label("Password").fill("password-123")
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url("**/dashboard", timeout=60000)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    desktop = browser.new_page(viewport={"width": 1280, "height": 900})
    second = browser.new_page(viewport={"width": 1280, "height": 900})
    mobile = browser.new_page(viewport={"width": 375, "height": 812})
    progress_calls = []
    desktop.on("request", lambda request: progress_calls.append(request.url)
               if request.method == "GET" and f"/api/events/{event_id}/progress" in request.url else None)
    login(desktop, owner_email)
    desktop.goto(f"{base}/attendance?eventId={event_id}", wait_until="domcontentloaded", timeout=60000)
    desktop.get_by_role("button", name="Review records without time-in").click()
    expect(desktop.get_by_text("S2", exact=True)).to_be_visible()
    desktop.get_by_role("button", name="Show checked-in records").click()
    expect(desktop.get_by_text("S1", exact=True)).to_be_visible()
    desktop.get_by_role("link", name="View progress").click()
    desktop.wait_for_url("**/attendance/progress?eventId=*")
    expect(desktop.get_by_role("heading", name="Progress contract")).to_be_visible()
    expect(desktop.get_by_role("progressbar", name="Students checked in")).to_have_attribute("aria-valuenow", "33.33333333333333")
    assert len(progress_calls) == 1, f"expected one initial progress request, got {progress_calls}"

    desktop.get_by_role("button", name="View students").click()
    heading = desktop.get_by_role("heading", name="Not yet checked in — All eligible students")
    expect(heading).to_be_focused()
    expect(desktop.get_by_text("S2", exact=True)).to_be_visible()
    expect(desktop.get_by_text("S3", exact=True)).to_be_visible()

    login(second, viewer_email)
    recorded = second.evaluate("""async ({eventId}) => {
      const response = await fetch('/api/records', { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventId, studentId: 'S3', method: 'MANUAL', expectedMode: 'TIME_IN' }) });
      return { status: response.status, body: await response.text() };
    }""", {"eventId": event_id})
    assert recorded["status"] in (200, 201), recorded["body"]
    expect(desktop.get_by_text("S3", exact=True)).not_to_be_visible(timeout=20000)
    expect(desktop.get_by_text("2 / 3", exact=False)).to_be_visible()

    desktop.get_by_role("button", name="View missing students for Section A, 1 not yet checked in").click()
    expect(desktop.get_by_text("S2", exact=True)).to_be_visible()
    expect(desktop.get_by_text("S3", exact=True)).not_to_be_visible()
    desktop.get_by_label("Status").select_option("CHECKED_IN")
    expect(desktop.get_by_text("S1", exact=True)).to_be_visible()

    login(mobile, owner_email)
    mobile.goto(f"{base}/attendance/progress?eventId={event_id}", wait_until="domcontentloaded", timeout=60000)
    expect(mobile.get_by_role("heading", name="Progress contract")).to_be_visible()
    mobile.get_by_role("button", name="View students").click()
    expect(mobile.get_by_role("heading", name="Not yet checked in — All eligible students")).to_be_visible()
    assert mobile.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "mobile page overflows horizontally"
    print(f"Progress browser checks passed: record recovery, two sessions, live update, group/status drill-down, focus, mobile width; {len(progress_calls)} desktop progress requests.")
    browser.close()
