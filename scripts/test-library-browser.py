"""Optional real-browser checks; all writes target the API runner's disposable DB."""
import base64
import json
import sys
from playwright.sync_api import sync_playwright, expect

base, email = sys.argv[1:3]
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(base + "/login")
    page.get_by_label("Email").fill(email)
    page.get_by_label("Password").fill("password-123")
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url("**/dashboard")
    page.get_by_role("link", name="Library Attendance", exact=True).click()
    expect(page.get_by_role("heading", name="Library Attendance", exact=True)).to_be_visible()
    page.wait_for_load_state("networkidle")
    writes = []
    page.on("request", lambda req: writes.append(json.loads(req.post_data)) if req.method == "POST" and req.url.endswith("/api/library/scan") else None)

    def find_person(value):
        page.get_by_role("button", name="Manual Search", exact=True).click()
        page.get_by_label("Find visitor by name or ID").fill(value)
        page.get_by_role("button", name="Find", exact=True).click()
        expect(page.get_by_role("button", name="Record scan", exact=True)).to_be_visible()

    find_person("00000000002")
    page.get_by_role("button", name="Record scan", exact=True).click()
    expect(page.get_by_text("TIME IN RECORDED", exact=True)).to_be_visible()
    assert len(writes) == 1
    page.get_by_role("button", name="Next visitor", exact=True).click()
    find_person("00000000002")
    page.get_by_role("button", name="Record scan", exact=True).click()
    expect(page.get_by_text("Duplicate scan: wait 10 seconds after the last scan.", exact=True)).to_be_visible()
    assert len(writes) == 1, "local cooldown sent a toggle"
    page.get_by_role("button", name="Next visitor", exact=True).click()

    page.get_by_role("button", name="Register Employee", exact=True).click()
    page.get_by_label("Employee ID", exact=True).fill("EMPBROWSER1")
    page.get_by_label("First name", exact=True).fill("Browser")
    page.get_by_label("Last name", exact=True).fill("Employee")
    page.get_by_role("button", name="Save Employee", exact=True).click()
    expect(page.get_by_role("heading", name="Visitor QR Code", exact=True)).to_be_visible()
    expect(page.locator("[role=dialog] .student-qr-code svg")).to_be_visible()
    camera_qr = base64.b64encode(page.locator("[role=dialog] .student-qr-code").screenshot()).decode()
    assert "YEAR_1" not in page.get_by_role("dialog", name="Visitor QR Code").inner_text()
    page.emulate_media(media="print")
    expect(page.locator(".student-qr-print-area")).to_be_visible()
    page.emulate_media(media="screen")
    page.get_by_role("button", name="Close", exact=True).click()

    # Feed an actual application-generated QR through the camera/decoder path.
    page.evaluate("""async png => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + png;
        await image.decode();
        window.cameraQrVisible = true;
        navigator.mediaDevices.getUserMedia = async () => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 720;
            const stream = canvas.captureStream(30);
            const [track] = stream.getVideoTracks();
            const draw = () => {
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, 720, 720);
                if (window.cameraQrVisible) ctx.drawImage(image, 180, 180, 360, 360);
                if (track.readyState === 'live') requestAnimationFrame(draw);
            };
            draw();
            return stream;
        };
    }""", camera_qr)
    scanner = page.get_by_role("region", name="Library scanner")
    page.get_by_role("button", name="Open Camera", exact=True).click()
    expect(scanner.get_by_text("TIME IN RECORDED", exact=True)).to_be_visible(timeout=30000)
    expect(scanner.get_by_text("Processing...", exact=True)).not_to_be_visible()
    expect(scanner.locator("video")).to_have_count(0)
    expect(page.get_by_role("button", name="Manual Search", exact=True)).to_be_disabled()
    expect(scanner.get_by_role("button", name="Next visitor", exact=True)).to_be_visible()
    assert len(writes) == 2
    page.evaluate("window.cameraQrVisible = false")
    scanner.get_by_role("button", name="Next visitor", exact=True).click()
    expect(page.get_by_text("Scanner: Ready", exact=True)).to_be_visible()
    page.evaluate("window.cameraQrVisible = true")
    expect(scanner.get_by_text("Duplicate scan: wait 10 seconds after the last scan.", exact=True)).to_be_visible()
    expect(scanner.get_by_text("Processing...", exact=True)).not_to_be_visible()
    assert len(writes) == 2, "camera cooldown sent another toggle"
    page.evaluate("window.cameraQrVisible = false")
    scanner.get_by_role("button", name="Next visitor", exact=True).click()
    expect(scanner.locator("video")).to_have_count(1)
    scanner.get_by_role("button", name="Close camera", exact=True).click()

    page.get_by_role("button", name="Close Forgotten Visits", exact=False).click()
    expect(page.get_by_text("These visits will receive a Time Out", exact=False)).to_be_visible()
    page.get_by_role("button", name="Cancel", exact=True).click()
    page.get_by_role("button", name="Close Forgotten Visits", exact=False).click()
    page.get_by_role("button", name="Confirm Close", exact=True).click()
    expect(page.get_by_role("status").filter(has_text="visit(s) closed by librarian.")).to_be_visible()
    page.get_by_role("listitem").filter(has_text="2026-08-04").get_by_role("button", name="Review Time Out", exact=True).click()
    page.get_by_label("Time Out (Asia/Manila)", exact=True).fill("2026-08-04T18:00")
    page.get_by_role("button", name="Confirm Close", exact=True).click()
    expect(page.get_by_role("heading", name="Review forgotten Time Out")).not_to_be_visible()

    page.screenshot(path="/tmp/library-desktop.png", full_page=True)
    page.get_by_label("Period", exact=False).select_option("monthly")
    page.get_by_label("Entry date", exact=True).fill("2026-08-15")
    page.get_by_label("Visitor type", exact=False).select_option("STUDENT")
    expect(page.get_by_role("cell", name="Closed by librarian", exact=False).first).to_be_visible()
    with page.expect_download() as download_info:
        page.get_by_role("button", name="Export CSV", exact=True).click()
    with open(download_info.value.path(), encoding="utf-8") as export:
        csv = export.read()
        assert "Closed by librarian" in csv and "2026-08-03 17:00:00" in csv
    page.screenshot(path="/tmp/library-desktop.png", full_page=True)

    # Commit the POST then lose its response: the UI must require a history check.
    def lose_response(route):
        route.fetch()
        route.fulfill(status=200, content_type="application/json", body='{"success":true,')
    page.route("**/api/library/scan", lose_response)
    page.get_by_label("Visitor type", exact=False).select_option("EMPLOYEE")
    find_person("00000000003")
    page.get_by_role("button", name="Record scan", exact=True).click()
    expect(page.get_by_text("Connection problem: attendance result is uncertain.", exact=False)).to_be_visible()
    expect(page.get_by_role("button", name="Manual Search", exact=True)).to_be_disabled()
    expect(page.get_by_role("button", name="Next visitor", exact=True)).to_have_count(0)
    def fail_history(route):
        if "search=00000000003" in route.request.url:
            route.abort("failed")
        else:
            route.continue_()
    page.route("**/api/library/visits?*", fail_history)
    page.get_by_role("button", name="Refresh and check history", exact=True).click()
    expect(page.get_by_text("Could not check this visitor’s history.", exact=False)).to_be_visible()
    expect(page.get_by_role("button", name="Next visitor", exact=True)).to_have_count(0)
    page.unroute("**/api/library/visits?*", fail_history)
    page.get_by_role("button", name="Refresh and check history", exact=True).click()
    expect(page.get_by_text("History refreshed. Latest saved visit:", exact=False)).to_be_visible()
    expect(page.get_by_label("Visitor type", exact=False)).to_have_value("ALL")
    expect(page.get_by_label("Period", exact=False)).to_have_value("daily")
    expect(page.get_by_role("cell", name="Lost Response", exact=False)).to_be_visible()
    page.unroute("**/api/library/scan", lose_response)
    page.get_by_role("button", name="Next visitor", exact=True).click()
    find_person("00000000003")
    page.get_by_role("button", name="Classify as Employee", exact=True).click()
    page.get_by_role("button", name="Confirm classification", exact=True).click()
    expect(page.get_by_role("heading", name="Visitor QR Code", exact=True)).to_be_visible()
    page.get_by_role("button", name="Close", exact=True).click()
    page.get_by_label("View simulated demonstration data only").check()
    expect(page.get_by_role("button", name="Open Camera", exact=True)).to_be_disabled()
    expect(page.get_by_text("DEMONSTRATION DATA — simulated visits", exact=False)).to_be_visible()

    mobile = context.new_page()
    mobile.set_viewport_size({"width": 390, "height": 844})
    mobile.goto(base + "/attendance")
    mobile.get_by_role("link", name="Library Attendance", exact=False).click()
    expect(mobile.get_by_role("heading", name="Library Attendance", exact=True)).to_be_visible()
    expect(mobile.get_by_role("button", name="Manual Search", exact=True)).to_be_visible()
    mobile.wait_for_load_state("networkidle")
    assert mobile.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "mobile viewport overflow"
    mobile.screenshot(path="/tmp/library-mobile.png", full_page=True)
    assert errors == [], errors
    browser.close()
print("Library browser passed: camera scan/acknowledgement/cooldown, manual scan, employee registration/QR print, bulk/individual correction, history/CSV, uncertain result, demo view and mobile navigation.")
