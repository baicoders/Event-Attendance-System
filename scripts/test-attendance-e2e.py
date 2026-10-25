"""Browser-only actions with independent, read-only PostgreSQL evidence.

Called by test-attendance-e2e.mjs; fixture credentials and CA pins are synthetic.
"""
import asyncio
import csv
import io
import json
import re
import subprocess
import sys
import time
import traceback
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from playwright.async_api import async_playwright, expect

# This suite checks correctness; readiness is not a five-second performance SLO.
expect.set_options(timeout=30000)

F = json.loads(Path(sys.argv[1]).read_text())
BASE = F["base"]
OUT = Path(F["artifacts"])
RESULTS = []
REPORT_COMPLETE = False
STATES = {}
CONTEXTS = []
BROWSERS = []
DIAGNOSTICS = []
EVIDENCE = []
SCENARIO = "setup"
MOBILE = {"viewport": {"width": 393, "height": 851}, "is_mobile": True, "has_touch": True,
          "device_scale_factor": 1, "user_agent": "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"}


def evidence(event=None, student=None, title=None):
    params = {"eventId": event} if event else {"title": title}
    if student:
        params["studentId"] = student
    request = Request(F["evidenceUrl"] + "/?" + urlencode(params), headers={"Authorization": "Bearer " + F["evidenceToken"]})
    with urlopen(request, timeout=10) as response:
        snapshot = json.load(response)
    EVIDENCE.append({"scenario": SCENARIO, "query": params, "snapshot": snapshot})
    return snapshot


async def launch(p, video=None):
    args = ["--no-sandbox", "--ignore-certificate-errors-spki-list=" + F["pin"]]
    if video:
        args += ["--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + str(video)]
    browser = await p.chromium.launch(headless=True, executable_path=F["chrome"], args=args, timeout=90000)
    BROWSERS.append(browser)
    return browser


async def context(browser, user="owner", mobile=True, no_internet=False, camera=False, authenticated=True):
    options = dict(MOBILE) if mobile else {"viewport": {"width": 1440, "height": 1000}}
    options.update(timezone_id="Asia/Manila", locale="en-PH", accept_downloads=True)
    if authenticated:
        options["storage_state"] = STATES[user]
    if camera:
        options["permissions"] = ["camera"]
    ctx = await browser.new_context(**options)
    CONTEXTS.append(ctx)
    await ctx.tracing.start(screenshots=True, snapshots=True, sources=True)

    async def network(route):
        request = route.request
        external = urlsplit(request.url).netloc != urlsplit(BASE).netloc
        if external and request.url.startswith(("http:", "https:")):
            DIAGNOSTICS.append({"scenario": SCENARIO, "type": "external_request", "url": request.url, "blocked": no_internet})
            if no_internet:
                await route.abort("internetdisconnected")
                return
        await route.continue_()

    await ctx.route("**/*", network)
    ctx.on("page", lambda page: observe(page))
    return ctx


def observe(page):
    page.on("pageerror", lambda error: DIAGNOSTICS.append({"scenario": SCENARIO, "type": "pageerror", "message": str(error)}))
    page.on("requestfailed", lambda request: DIAGNOSTICS.append({"scenario": SCENARIO, "type": "requestfailed", "method": request.method, "url": request.url, "failure": request.failure}))
    page.on("response", lambda response: DIAGNOSTICS.append({"scenario": SCENARIO, "type": "http_error", "status": response.status, "method": response.request.method, "url": response.url}) if response.status >= 400 else None)


async def login(page, user):
    await page.goto(BASE + "/login", wait_until="domcontentloaded", timeout=60000)
    await page.get_by_label("Email", exact=True).fill(user["email"])
    await page.get_by_label("Password", exact=True).fill(F["password"])
    await page.get_by_role("button", name="Sign in", exact=True).click()
    await page.wait_for_url("**/dashboard", wait_until="domcontentloaded", timeout=60000)
    assert await page.evaluate("window.isSecureContext"), "HTTPS must provide a secure context"
    cookies = await page.context.cookies()
    cookie = next(item for item in cookies if item["name"] == "event-attendance-auth")
    assert cookie["secure"] and cookie["httpOnly"], "Production login cookie must remain Secure and HttpOnly behind Caddy"


async def page_for(browser, event, user="owner", operator=False, mobile=True, no_internet=False, camera=False):
    ctx = await context(browser, user=user, mobile=mobile, no_internet=no_internet, camera=camera)
    page = await ctx.new_page()
    route = "/attendance/operator" if operator else "/attendance"
    await page.goto(f"{BASE}{route}?eventId={event}", wait_until="domcontentloaded", timeout=60000)
    if operator:
        await expect(page.get_by_role("heading", name=F["events"][next(key for key, value in F["events"].items() if value["id"] == event)]["title"], exact=True)).to_be_visible()
        await expect(page.get_by_role("button", name="Manual entry", exact=True)).to_be_enabled()
    else:
        await expect(page.get_by_label("Search name, USN or LRN")).to_be_visible()
    return page


async def click_record(page, button, student):
    async with page.expect_response(lambda response: response.url.endswith("/api/records") and response.request.method == "POST" and response.request.post_data_json.get("studentId") == student["id"]) as info:
        await button.click()
    response = await info.value
    assert response.ok, await response.text()
    body = await response.json()
    assert body["data"]["studentId"] == student["id"]


async def manual(page, student, query=None, mode="in", operator=False):
    if operator and not await page.get_by_label("Search name, USN or LRN").is_visible():
        await page.get_by_role("button", name="Manual entry", exact=True).click()
    search = page.get_by_label("Search name, USN or LRN")
    await search.fill(query or student["id"])
    button = page.get_by_role("button", name=f"Record time {mode} for E2E {student['lastName']}, {student['id']}", exact=True)
    await expect(button).to_be_enabled()
    await click_record(page, button, student)
    await expect(page.get_by_text(f"Time-{mode} recorded", exact=True).first).to_be_visible()


async def next_student(page):
    await page.get_by_role("button", name="Next student", exact=True).click()
    await expect(page.get_by_label("Search name, USN or LRN")).to_have_value("")


async def set_timeout(page, event, enabled=True):
    await page.goto(f"{BASE}/attendance?eventId={event}", wait_until="domcontentloaded", timeout=60000)
    label = "Start Recording Timeout" if enabled else "Timeout Mode: ON (tap to record time-ins)"
    await page.get_by_role("button", name=label, exact=True).click()
    after = "Timeout Mode: ON (tap to record time-ins)" if enabled else "Start Recording Timeout"
    await expect(page.get_by_role("button", name=after, exact=True)).to_be_visible()
    assert evidence(event)["event"]["isTimeout"] is enabled


async def scenario(name, function):
    global SCENARIO
    SCENARIO = name
    start_contexts = len(CONTEXTS)
    start_browsers = len(BROWSERS)
    start = time.monotonic()
    result = {"name": name, "status": "passed"}
    try:
        await asyncio.wait_for(function(), timeout=180)
    except asyncio.TimeoutError:
        result.update(status="infrastructure_failure", error="Scenario exceeded its 180-second safety deadline", traceback=traceback.format_exc())
    except Exception as error:
        result.update(status="failed", error=str(error) or type(error).__name__, traceback=traceback.format_exc())
    finally:
        result["durationMs"] = round((time.monotonic() - start) * 1000)
        for index, ctx in enumerate(CONTEXTS[start_contexts:]):
            for number, page in enumerate(ctx.pages):
                try:
                    await page.screenshot(path=str(OUT / f"{name}-{index}-{number}.png"), full_page=True, timeout=5000)
                    if result["status"] == "failed":
                        (OUT / f"{name}-{index}-{number}.txt").write_text(await page.locator("body").inner_text(timeout=3000))
                except Exception:
                    pass
            try:
                await ctx.tracing.stop(path=str(OUT / f"{name}-{index}.trace.zip") if result["status"] == "failed" else None)
                await ctx.close()
            except Exception:
                pass
        for owned_browser in BROWSERS[start_browsers:]:
            await owned_browser.close()
        RESULTS.append(result)
        save_report()
        print(f"{result['status'].upper()}: {name} ({result['durationMs']} ms)", flush=True)
        if result["status"] == "failed":
            print(result["error"][:1500], flush=True)


def save_report():
    (OUT / "database-evidence.json").write_text(json.dumps(EVIDENCE, indent=2))
    (OUT / "report.json").write_text(json.dumps({
        "status": "infrastructure_failure" if any(item["status"] == "infrastructure_failure" for item in RESULTS) else "running" if not REPORT_COMPLETE else "failed" if any(item["status"] != "passed" for item in RESULTS) else "passed",
        "completed": REPORT_COMPLETE,
        "environment": {"https": True, "proxy": "isolated Caddy internal CA", "browser": "Chrome, Android emulation + desktop", "rosterSize": 2000, "operators": 5, "physicalDevicesTested": False},
        "results": RESULTS, "diagnostics": DIAGNOSTICS,
    }, indent=2))


async def main():
    async with async_playwright() as p:
        browser = await launch(p)
        # Authenticate through the UI once per user. Each scenario still gets a fresh context.
        for label, user in [("admin", F["admin"])] + [("owner" if i == 0 else f"operator{i + 1}", user) for i, user in enumerate(F["operators"])]:
            ctx = await context(browser, mobile=False, authenticated=False)
            page = await ctx.new_page()
            await login(page, user)
            STATES[label] = await ctx.storage_state()
            await ctx.tracing.stop()
            await ctx.close()

        async def workflow():
            ctx = await context(browser, mobile=False)
            page = await ctx.new_page()
            await page.goto(BASE + "/calendar", wait_until="domcontentloaded", timeout=60000)
            await page.get_by_role("button", name="Create event", exact=True).click()
            await page.get_by_label("Title", exact=True).fill("E2E browser workflow")
            await page.get_by_label("Location", exact=True).fill("Synthetic school LAN")
            await page.get_by_role("button", name="Save draft", exact=True).click()
            await expect(page.get_by_role("heading", name="Create Event", exact=True)).not_to_be_visible()
            saved = evidence(title="E2E browser workflow")
            assert saved["event"]["status"] == "DRAFT"
            await page.get_by_role("button", name=re.compile(r"^All -")).click()
            await page.get_by_role("heading", name="E2E browser workflow", exact=True).click()
            await page.get_by_role("button", name="Submit for review", exact=True).click()
            await expect(page.get_by_role("heading", name="Edit Event", exact=True)).not_to_be_visible()
            assert evidence(title="E2E browser workflow")["event"]["status"] == "PENDING"
            admin_ctx = await context(browser, user="admin", mobile=False)
            admin = await admin_ctx.new_page()
            await admin.goto(BASE + "/calendar", wait_until="domcontentloaded", timeout=60000)
            review = admin.locator("div.rounded-lg").filter(has=admin.get_by_text("E2E browser workflow", exact=True)).filter(has=admin.get_by_role("button", name="Approve", exact=True))
            await review.get_by_role("button", name="Approve", exact=True).click()
            await expect(review.get_by_role("button", name="Approve", exact=True)).not_to_be_visible()
            approved = evidence(title="E2E browser workflow")
            assert approved["event"]["status"] == "APPROVED"
            assert approved["event"]["reviewedById"] == F["admin"]["id"]
            phone_ctx = await context(browser)
            phone = await phone_ctx.new_page()
            await phone.goto(BASE + "/attendance", wait_until="domcontentloaded", timeout=60000)
            await phone.get_by_role("combobox").click()
            await phone.get_by_role("option", name="E2E browser workflow", exact=True).click()
            await manual(phone, F["students"][0], query=F["students"][0]["usn"])
            snapshot = evidence(approved["event"]["id"])
            assert len(snapshot["records"]) == 1 and snapshot["records"][0]["recordedById"] == F["operators"][0]["id"]

        async def manual_identifiers():
            event = F["events"]["manual"]["id"]
            page = await page_for(browser, event)
            writes = []
            page.on("request", lambda request: writes.append(request) if request.method == "POST" and request.url.endswith("/api/records") else None)
            search = page.get_by_label("Search name, USN or LRN")
            await search.fill(F["students"][0]["usn"])
            await expect(page.get_by_role("button", name=re.compile("View details for E2E Student0001"))).to_be_visible()
            await search.press("Enter")
            assert writes == [], "Typing or pressing Enter must not record attendance"
            await page.get_by_role("button", name=re.compile("View details for E2E Student0001")).click()
            await expect(page.get_by_text("No record was found at the last check.", exact=True)).to_be_visible()
            assert writes == [], "Viewing student details must not record attendance"
            await search.focus()
            for index, query in [(0, F["students"][0]["usn"]), (1, F["students"][1]["lrn"]), (2, F["students"][2]["id"]), (3, "Student0004")]:
                await manual(page, F["students"][index], query=query)
                await next_student(page)
            snapshot = evidence(event)
            assert len(snapshot["records"]) == 4
            assert all(row["method"] == "MANUAL" and row["timein"] and row["timeout"] is None for row in snapshot["records"])
            original = snapshot["records"]
            await search.fill(F["students"][0]["usn"])
            await expect(page.get_by_role("button", name=re.compile("Already timed in for E2E Student0001"))).to_be_disabled()
            assert evidence(event)["records"] == original
            assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "Mobile page overflows"

        async def time_out():
            event = F["events"]["manual"]["id"]
            ctx = await context(browser, user="admin", mobile=False)
            admin = await ctx.new_page()
            await set_timeout(admin, event)
            page = await page_for(browser, event)
            for index in [0, 4]:
                await manual(page, F["students"][index], mode="out")
                await next_student(page)
            rows = {row["studentId"]: row for row in evidence(event)["records"]}
            assert rows[F["students"][0]["id"]]["timein"] and rows[F["students"][0]["id"]]["timeout"]
            assert rows[F["students"][4]["id"]]["timein"] is None and rows[F["students"][4]["id"]]["timeout"]
            await page.get_by_label("Search name, USN or LRN").fill(F["students"][4]["id"])
            await expect(page.get_by_role("button", name=re.compile("Already timed out for E2E Student0005"))).to_be_disabled()

        videos = {}
        render = await browser.new_page(viewport={"width": 720, "height": 720})
        for key, qr in F["qr"].items():
            png = Path(F["scratch"]) / (key + ".png")
            video = Path(F["scratch"]) / (key + ".y4m")
            await render.set_content('<body style="margin:0;background:white;display:flex;align-items:center;justify-content:center;height:720px">' + qr["svg"] + '</body>')
            await render.screenshot(path=str(png))
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-loop", "1", "-i", str(png), "-t", "1", "-r", "5", "-pix_fmt", "yuv420p", "-threads", "1", str(video)], check=True, timeout=20)
            videos[key] = video
        await render.close()

        async def qr_scan(key, no_internet=False):
            camera_browser = await launch(p, videos[key])
            event = F["events"]["eligibility" if key == "excluded" else "qr"]["id"]
            student_index = {"usn": 0, "lrn": 1, "legacy": 2}.get(key)
            before = evidence(event)
            page = await page_for(camera_browser, event, operator=True, camera=True, no_internet=no_internet)
            DIAGNOSTICS.append({"scenario": SCENARIO, "type": "camera_capabilities", "nativeBarcodeDetector": await page.evaluate("typeof BarcodeDetector !== \"undefined\"")})
            assert await page.evaluate("!!navigator.mediaDevices?.getUserMedia"), "Camera API unavailable over fixture HTTPS"
            await page.get_by_role("button", name="Open Camera", exact=True).click()
            if key in ["invalid", "excluded"]:
                await expect(page.get_by_text("Student unavailable for this event.", exact=True).first).to_be_visible(timeout=25000)
                assert evidence(event)["records"] == before["records"], "Rejected QR changed attendance"
            else:
                await expect(page.get_by_text("Time-in recorded", exact=True).first).to_be_visible(timeout=25000)
                first = evidence(event, F["students"][student_index]["id"])
                assert len(first["records"]) == 1 and first["records"][0]["method"] == "SCANNED"
                assert first["records"][0]["recordedById"] == F["operators"][0]["id"]
                await page.get_by_role("button", name="Close camera", exact=True).click()
                await page.get_by_role("button", name="Open Camera", exact=True).click()
                await expect(page.get_by_text("Time-in already recorded", exact=True).first).to_be_visible(timeout=25000)
                assert evidence(event, F["students"][student_index]["id"])["records"] == first["records"], "Repeated QR overwrote a timestamp"

        async def no_internet():
            ctx = await context(browser, no_internet=True, authenticated=False)
            page = await ctx.new_page()
            await login(page, F["operators"][0])
            event = F["events"]["network"]["id"]
            await page.goto(f"{BASE}/attendance?eventId={event}", wait_until="domcontentloaded", timeout=60000)
            await manual(page, F["students"][5], query=F["students"][5]["usn"])
            assert evidence(event, F["students"][5]["id"])["records"][0]["timein"]

        async def concurrency():
            event = F["events"]["concurrency"]["id"]
            pages = await asyncio.gather(*(page_for(browser, event, user="owner" if i == 0 else f"operator{i+1}") for i in range(5)))
            # Prepare all five actions before releasing clicks together.
            async def prepare(page, student):
                await page.get_by_label("Search name, USN or LRN").fill(student["id"])
                button = page.get_by_role("button", name=f"Record time in for E2E {student['lastName']}, {student['id']}", exact=True)
                await expect(button).to_be_enabled()
                return button
            buttons = await asyncio.gather(*(prepare(page, F["students"][10+i]) for i, page in enumerate(pages)))
            await asyncio.gather(*(click_record(page, button, F["students"][10+i]) for i, (page, button) in enumerate(zip(pages, buttons))))
            await asyncio.gather(*(expect(page.get_by_text("Time-in recorded", exact=True).first).to_be_visible() for page in pages))
            snapshot = evidence(event)
            assert len(snapshot["records"]) == 5
            assert {row["recordedById"] for row in snapshot["records"]} == {user["id"] for user in F["operators"]}
            await asyncio.gather(*(next_student(page) for page in pages))
            buttons = await asyncio.gather(*(prepare(page, F["students"][15]) for page in pages))
            # Stage all five real browser writes before releasing them to the server.
            # Otherwise a fast winner's live update can disable a slower phone's button.
            gate = asyncio.Event()
            arrivals = []
            async def hold_same_student(route):
                if route.request.method != "POST":
                    await route.continue_()
                    return
                arrivals.append(route.request)
                if len(arrivals) == len(pages):
                    gate.set()
                await gate.wait()
                await route.continue_()
            for page in pages:
                await page.route("**/api/records", hold_same_student)
            try:
                await asyncio.gather(*(click_record(page, button, F["students"][15]) for page, button in zip(pages, buttons)))
            finally:
                gate.set()
                for page in pages:
                    await page.unroute("**/api/records", hold_same_student)
            await asyncio.gather(*(expect(page.get_by_text(re.compile(r"^(Time-in recorded|Already recorded)$")).first).to_be_visible() for page in pages))
            snapshot = evidence(event, F["students"][15]["id"])
            assert len(snapshot["records"]) == 1 and len(snapshot["changes"]) == 1, "Concurrent scans must commit one record and history entry"

        async def network_loss(after_commit):
            event = F["events"]["network"]["id"]
            student = F["students"][7 if after_commit else 6]
            page = await page_for(browser, event, operator=True)
            await page.get_by_role("button", name="Manual entry", exact=True).click()
            await page.get_by_label("Search name, USN or LRN").fill(student["id"])
            button = page.get_by_role("button", name=f"Record time in for E2E {student['lastName']}, {student['id']}", exact=True)
            await expect(button).to_be_enabled()
            sent = []
            async def drop(route):
                if route.request.method != "POST":
                    await route.continue_()
                    return
                sent.append(route.request.post_data_json)
                if after_commit:
                    response = await route.fetch()
                    assert response.ok, await response.text()
                await route.abort("connectionreset")
            await page.route("**/api/records", drop)
            await button.click()
            panel = page.get_by_label("Manual attendance", exact=True)
            await expect(panel.get_by_text("result unknown", exact=True)).to_be_visible()
            # A completed GET turns the Playwright loop without introducing a blind sleep.
            await panel.get_by_role("button", name="Check current record", exact=True).click()
            message = "Current record has a timestamp" if after_commit else "No matching timestamp is currently recorded."
            await expect(panel.get_by_text(message, exact=False)).to_be_visible()
            assert len(sent) == 1, "An uncertain write was replayed automatically"
            snapshot = evidence(event, student["id"])
            assert len(snapshot["records"]) == (1 if after_commit else 0)
            await page.unroute("**/api/records", drop)
            if after_commit:
                await panel.get_by_label("Search name, USN or LRN").focus()
                await expect(panel.get_by_role("button", name=re.compile("Already timed in for"))).to_be_disabled(timeout=20000)
            else:
                await page.get_by_role("button", name="Acknowledge result", exact=True).click()
                await manual(page, student, operator=True)
            assert len(evidence(event, student["id"])["records"]) == 1

        async def mode_conflict():
            event = F["events"]["mode"]["id"]
            phone = await page_for(browser, event, user="operator2", operator=True)
            # Hold this phone's event observation at TIME_IN, while the real server changes.
            async def stale(route):
                response = await route.fetch()
                body = await response.json()
                body["data"]["isTimeout"] = False
                await route.fulfill(response=response, json=body)
            await phone.route(f"**/api/events/{event}", stale)
            await phone.get_by_role("button", name="Manual entry", exact=True).click()
            student = F["students"][8]
            await phone.get_by_label("Search name, USN or LRN").fill(student["id"])
            ctx = await context(browser, user="admin", mobile=False)
            admin = await ctx.new_page()
            await set_timeout(admin, event)
            await phone.get_by_role("button", name=f"Record time in for E2E {student['lastName']}, {student['id']}", exact=True).click()
            await expect(phone.get_by_label("Manual attendance", exact=True).get_by_text("mode changed", exact=True)).to_be_visible()
            assert evidence(event)["records"] == [], "Stale time-in request wrote the opposite mode"
            await phone.unroute(f"**/api/events/{event}", stale)
            await phone.reload(wait_until="domcontentloaded", timeout=60000)
            await expect(phone.get_by_text("TIME OUT", exact=True)).to_be_visible()
            await manual(phone, student, mode="out", operator=True)
            row = evidence(event)["records"][0]
            assert row["timeout"] and row["timein"] is None

        async def corrections():
            event = F["events"]["corrections"]["id"]
            student = F["students"][9]
            phone = await page_for(browser, event)
            await manual(phone, student)
            original = evidence(event)["records"][0]
            ctx = await context(browser, user="admin", mobile=False)
            page = await ctx.new_page()
            await page.goto(f"{BASE}/attendance/corrections?eventId={event}&studentId={student['id']}", wait_until="domcontentloaded", timeout=60000)
            sheet = page.get_by_role("dialog")
            await sheet.get_by_role("button", name="Correct", exact=True).click()
            await sheet.get_by_label("Reason", exact=True).fill("E2E verify correction history")
            # Move time-in one minute earlier in Manila time, preserving valid chronology.
            value = await sheet.get_by_label("Time in", exact=True).input_value()
            from datetime import datetime, timedelta
            changed = (datetime.fromisoformat(value) - timedelta(minutes=1)).isoformat(timespec="seconds")
            await sheet.get_by_label("Time in", exact=True).fill(changed)
            await sheet.get_by_role("button", name="Review and correct", exact=True).click()
            async with page.expect_response(lambda response: "/attendance-corrections" in response.url and response.request.method == "POST") as changed_response:
                await page.get_by_role("dialog", name="Correct attendance?", exact=True).get_by_role("button", name="Confirm", exact=True).click()
            assert (await changed_response.value).ok
            await expect(sheet.get_by_text("Attendance change saved.", exact=True)).to_be_visible()
            corrected = evidence(event)["records"][0]
            assert corrected["timein"] != original["timein"] and corrected["revision"] == original["revision"] + 1
            for action in ["Void", "Restore"]:
                await sheet.get_by_role("button", name=action, exact=True).click()
                await sheet.get_by_label("Reason", exact=True).fill(f"E2E verify {action.lower()} history")
                await sheet.get_by_role("button", name="Review and " + action.lower(), exact=True).click()
                async with page.expect_response(lambda response: "/attendance-corrections" in response.url and response.request.method == "POST") as changed_response:
                    await page.get_by_role("dialog", name=action + " attendance?", exact=True).get_by_role("button", name="Confirm", exact=True).click()
                assert (await changed_response.value).ok
                await expect(sheet.get_by_text("Attendance change saved.", exact=True)).to_be_visible()
                if action == "Void":
                    assert evidence(event)["records"] == []
                else:
                    restored = evidence(event)["records"][0]
                    assert restored["id"] != corrected["id"] and restored["timein"] == corrected["timein"]
            changes = evidence(event)["changes"]
            assert [row["action"] for row in changes] == ["CREATE", "CORRECT", "VOID", "RESTORE"]
            assert all(row["reason"] and row["actorId"] == F["admin"]["id"] for row in changes[1:])
            assert changes[0]["before"] is None
            assert changes[0]["after"]["timein"] == original["timein"]
            assert changes[1]["before"]["timein"] == original["timein"]
            assert changes[1]["after"]["timein"] == corrected["timein"]
            assert changes[2]["before"]["timein"] == corrected["timein"] and changes[2]["after"] is None
            assert changes[3]["before"] is None and changes[3]["after"]["timein"] == corrected["timein"]

        async def reports():
            event = F["events"]["reports"]["id"]
            phone = await page_for(browser, event)
            await manual(phone, F["students"][20])
            await next_student(phone)
            await manual(phone, F["students"][21])
            ctx = await context(browser, user="admin", mobile=False)
            page = await ctx.new_page()
            await set_timeout(page, event)
            await phone.reload(wait_until="domcontentloaded", timeout=60000)
            await manual(phone, F["students"][22], mode="out")
            await page.goto(f"{BASE}/attendance/progress?eventId={event}", wait_until="domcontentloaded", timeout=60000)
            progress = page.get_by_role("progressbar", name="Students checked in")
            await expect(progress).to_have_attribute("aria-valuenow", "0.1")
            await expect(page.get_by_text("2 / 2000", exact=False).first).to_be_visible()
            await page.goto(f"{BASE}/reports/events/{event}", wait_until="domcontentloaded", timeout=60000)
            await page.get_by_role("button", name="Export", exact=True).click()
            await expect(page.get_by_role("button", name="Download CSV — 2000 rows", exact=True)).to_be_enabled()
            async with page.expect_download() as info:
                await page.get_by_role("button", name="Download CSV — 2000 rows", exact=True).click()
            download = await info.value
            csv_path = OUT / "attendance-full.csv"
            await download.save_as(csv_path)
            text = csv_path.read_text(encoding="utf-8-sig")
            rows = list(csv.DictReader(io.StringIO(text)))
            assert len(rows) == 2000
            assert F["students"][20]["id"] in text and F["students"][22]["id"] in text
            # Compare exported timestamps and statuses, not just file download success.
            header_id = next(key for key in rows[0] if key.lower() == "student id")
            by_id = {row[header_id]: row for row in rows}
            assert "Late" in by_id[F["students"][20]["id"]].values()
            assert "Absent" in by_id[F["students"][22]["id"]].values()
            snapshot = evidence(event)
            for record in snapshot["records"]:
                exported = by_id[record["studentId"]]
                assert exported["Time in (UTC)"] == (record["timein"] or "")
                assert exported["Time out (UTC)"] == (record["timeout"] or "")
            await page.goto(f"{BASE}/reports/events/{event}/print?view=summary&groupBy=SECTION", wait_until="domcontentloaded", timeout=60000)
            await expect(page.get_by_role("heading", name="Event Attendance Summary", exact=True)).to_be_visible()
            total = page.get_by_role("row").filter(has=page.get_by_role("cell", name="TOTAL", exact=True))
            await expect(total.get_by_role("cell")).to_have_text(["TOTAL", "2000", "0", "2", "1998", "2", "0.1%"])
            await page.pdf(path=str(OUT / "attendance-summary.pdf"), print_background=True)
            assert len(evidence(event)["records"]) == 3

        async def permissions():
            event = F["events"]["corrections"]["id"]
            ctx = await context(browser, user="operator2", mobile=False)
            page = await ctx.new_page()
            response_codes = []
            page.on("response", lambda response: response_codes.append(response.status) if "/attendance-review" in response.url else None)
            await page.goto(f"{BASE}/attendance/corrections?eventId={event}", wait_until="domcontentloaded", timeout=60000)
            await expect(page.get_by_text("Could not load review evidence.", exact=False)).to_be_visible()
            assert 403 in response_codes
            assert await page.get_by_role("button", name="Correct", exact=True).count() == 0

        async def live_progress():
            event = F["events"]["live"]["id"]
            first = await page_for(browser, event)
            await manual(first, F["students"][17])
            ctx = await context(browser, user="admin", mobile=False)
            page = await ctx.new_page()
            await page.goto(f"{BASE}/attendance/progress?eventId={event}", wait_until="domcontentloaded", timeout=60000)
            summary = page.get_by_label("Overall attendance progress", exact=True)
            await expect(summary.get_by_text("1 / 2000", exact=False)).to_be_visible()
            second = await page_for(browser, event, user="operator2")
            await manual(second, F["students"][18])
            await expect(summary.get_by_text("2 / 2000", exact=False)).to_be_visible(timeout=25000)
            await page.get_by_label("Break down by").select_option("SECTION")
            await page.get_by_role("button", name="View missing students for E2E Section, 18 not yet checked in", exact=True).click()
            await expect(page.get_by_role("heading", name="Not yet checked in — E2E Section", exact=True)).to_be_visible()
            assert len(evidence(event)["records"]) == 2

        async def correction_conflict():
            event = F["events"]["conflict"]["id"]
            student = F["students"][19]
            phone = await page_for(browser, event)
            await manual(phone, student)
            pages = []
            from datetime import datetime, timedelta
            for user, minutes in [("admin", 1), ("owner", 2)]:
                ctx = await context(browser, user=user, mobile=False)
                page = await ctx.new_page()
                await page.goto(f"{BASE}/attendance/corrections?eventId={event}&studentId={student['id']}", wait_until="domcontentloaded", timeout=60000)
                sheet = page.get_by_role("dialog")
                await sheet.get_by_role("button", name="Correct", exact=True).click()
                value = await sheet.get_by_label("Time in", exact=True).input_value()
                proposed = (datetime.fromisoformat(value) - timedelta(minutes=minutes)).isoformat(timespec="seconds")
                await sheet.get_by_label("Time in", exact=True).fill(proposed)
                await sheet.get_by_label("Reason", exact=True).fill(f"E2E correction by {user}")
                pages.append((page, sheet, proposed))
            for index, (page, sheet, proposed) in enumerate(pages):
                await sheet.get_by_role("button", name="Review and correct", exact=True).click()
                async with page.expect_response(lambda response: "/attendance-corrections" in response.url and response.request.method == "POST") as response_info:
                    await page.get_by_role("dialog", name="Correct attendance?", exact=True).get_by_role("button", name="Confirm", exact=True).click()
                response = await response_info.value
                assert response.status == (200 if index == 0 else 409)
                if index:
                    await expect(sheet.get_by_text("Attendance changed on another device.", exact=False)).to_be_visible()
                    await expect(sheet.get_by_label("Time in", exact=True)).to_have_value(proposed)
            snapshot = evidence(event)
            assert len(snapshot["changes"]) == 2
            assert snapshot["changes"][-1]["reason"] == "E2E correction by admin"

        async def camera_permission_recovery():
            camera_browser = await launch(p, videos["legacy"])
            event = F["events"]["permission"]["id"]
            page = await page_for(camera_browser, event, operator=True)
            await page.get_by_role("button", name="Open Camera", exact=True).click()
            await expect(page.get_by_text("Camera permission denied.", exact=False)).to_be_visible(timeout=15000)
            assert evidence(event)["records"] == []
            # Exercise the scanner's own fallback button, alongside the operator-panel button.
            await page.get_by_role("button", name="Manual entry", exact=True).first.click()
            await manual(page, F["students"][23], operator=True)
            await page.get_by_role("button", name="Return to scanner", exact=True).click()
            await page.context.grant_permissions(["camera"], origin=BASE)
            async with page.expect_response(lambda response: response.url.endswith("/api/records") and response.request.method == "POST" and response.request.post_data_json.get("studentId") == F["students"][2]["id"]) as scanned:
                await page.get_by_role("button", name="Open Camera", exact=True).click()
            assert (await scanned.value).ok
            await expect(page.get_by_text("Time-in recorded", exact=True).first).to_be_visible(timeout=25000)
            snapshot = evidence(event)
            assert len(snapshot["records"]) == 2
            assert {row["method"] for row in snapshot["records"]} == {"MANUAL", "SCANNED"}

        await scenario("01-create-submit-approve-record", workflow)
        await scenario("02-manual-identifiers-and-duplicates", manual_identifiers)
        await scenario("03-timeout-and-missing-timein", time_out)
        await scenario("04-camera-usn-and-duplicates", lambda: qr_scan("usn"))
        await scenario("05-camera-lrn-and-duplicates", lambda: qr_scan("lrn"))
        await scenario("06-camera-legacy-id", lambda: qr_scan("legacy"))
        await scenario("07-camera-invalid-code", lambda: qr_scan("invalid"))
        await scenario("08-camera-ineligible-student", lambda: qr_scan("excluded"))
        await scenario("09-no-internet-login-manual", no_internet)
        # Use a fresh event for offline QR, so a failed camera cannot be masked by earlier records.
        original_event = F["events"]["qr"]
        F["events"]["qr"] = F["events"]["eligibility"]
        await scenario("10-no-internet-camera", lambda: qr_scan("usn", no_internet=True))
        F["events"]["qr"] = original_event
        await scenario("11-five-operators-concurrent", concurrency)
        await scenario("12-connection-lost-before-save", lambda: network_loss(False))
        await scenario("13-response-lost-after-commit", lambda: network_loss(True))
        await scenario("14-stale-mode-conflict-recovery", mode_conflict)
        await scenario("15-admin-correct-void-restore", corrections)
        await scenario("16-progress-export-print", reports)
        await scenario("17-nonowner-correction-denied", permissions)
        await scenario("18-live-progress-two-devices", live_progress)
        await scenario("19-correction-conflict", correction_conflict)
        await scenario("20-camera-permission-recovery", camera_permission_recovery)
        for item in BROWSERS:
            await item.close()


try:
    asyncio.run(main())
    REPORT_COMPLETE = True
except Exception as error:
    RESULTS.append({"name": SCENARIO, "status": "infrastructure_failure", "error": str(error), "traceback": traceback.format_exc()})
    save_report()
    raise
finally:
    save_report()
print(f"{sum(row['status'] == 'passed' for row in RESULTS)}/{len(RESULTS)} attendance scenarios passed", flush=True)
sys.exit(1 if any(row["status"] != "passed" for row in RESULTS) else 0)
