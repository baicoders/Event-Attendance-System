/** Browser companion for the disposable reviewed-import fixture.
 * Uses installed Python Playwright and the real local Chrome binary.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const browserScript = String.raw`
import json, re, sys, time
from playwright.sync_api import sync_playwright, expect

config = json.loads(sys.stdin.readline())
base = config["base"]
name, value = config["cookie"].split("=", 1)

def upload(page, name, csv):
    page.get_by_label("Choose CSV file").set_input_files({"name": name, "mimeType": "text/csv", "buffer": csv.encode("utf-8")})
    expect(page.get_by_text(name, exact=True)).to_be_visible()

def review(page):
    page.get_by_role("button", name="Review import", exact=True).click()
    expect(page.get_by_label("Import review rows")).to_be_visible(timeout=60000)

def confirm(page):
    page.get_by_role("button", name="Review & confirm import", exact=True).click()
    dialog = page.get_by_role("dialog")
    expect(dialog).to_be_visible()
    expect(dialog).to_contain_text("Import admin")
    expect(dialog).to_contain_text(re.compile("absent|not present", re.I))
    # The global confirmation primitive owns the final action label.
    buttons = dialog.get_by_role("button").all()
    final = [button for button in buttons if re.search(r"import|confirm", button.inner_text(), re.I)]
    assert len(final) == 1, "one final consequential confirmation action"
    final[0].focus()
    expect(final[0]).to_be_focused()
    page.keyboard.press("Enter")

def mobile_width(page):
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "375px import screen overflows horizontally"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    context.add_cookies([{"name": name, "value": value, "url": base, "httpOnly": True, "sameSite": "Lax"}])
    page = context.new_page()
    commit_requests = []
    page.on("request", lambda request: commit_requests.append(request.post_data)
            if request.url.endswith("/api/students/imports/commit") else None)
    preview_requests = []
    page.on("request", lambda request: preview_requests.append(json.loads(request.post_data))
            if request.url.endswith("/api/students/imports/preview") else None)
    page.goto(base + "/students/import", wait_until="domcontentloaded")
    expect(page.get_by_label("Choose CSV file")).to_be_visible()
    page.get_by_label("Choose CSV file").focus()
    with page.expect_file_chooser() as chooser:
        page.keyboard.press("Enter")
    chooser.value.set_files({"name": "keyboard-selected.csv", "mimeType": "text/csv", "buffer": config["raceB"].encode("utf-8")})
    expect(page.get_by_text("keyboard-selected.csv", exact=True)).to_be_visible()
    page.get_by_role("button", name="Reset", exact=True).click()
    previews_before_oversize = len(preview_requests)
    page.get_by_label("Choose CSV file").set_input_files({"name": "oversized.csv", "mimeType": "text/csv", "buffer": b"x" * (10 * 1024 * 1024 + 1)})
    expect(page.get_by_role("alert").filter(has_text="exceeds the 10 MiB technical file limit")).to_be_visible()
    assert len(preview_requests) == previews_before_oversize, "oversized source never dispatches server review"
    upload(page, "large-advisory.csv", config["large"])
    expect(page.get_by_role("button", name="Review import", exact=True)).to_be_disabled()
    expect(page.get_by_text("Large import — 2,000 rows", exact=True)).to_be_visible()
    page.get_by_role("button", name="Continue anyway", exact=True).click()
    review(page)
    page.set_viewport_size({"width": 375, "height": 812})
    mobile_width(page)
    page.screenshot(path="/tmp/student-import-mobile-large-review.png", full_page=True)
    page.get_by_role("button", name="Replace file", exact=True).click()
    page.set_viewport_size({"width": 1440, "height": 1000})
    # A Group creation is durable independent work. Its late completion must
    # never revive the CSV review that opened the sheet after source replacement.
    upload(page, "race-source-a.csv", config["raceA"])
    review(page)
    page.get_by_role("button", name="Create group browser-race-created", exact=True).click()
    pending_group_routes = []
    def pause_group(route):
        pending_group_routes.append(route)
    page.route("**/api/groups", pause_group)
    race_dialog = page.get_by_role("dialog")
    race_dialog.get_by_label("Name", exact=True).fill("Group from abandoned source A")
    race_dialog.get_by_role("button", name="Create", exact=True).click()
    for attempt in range(100):
        if pending_group_routes:
            break
        page.wait_for_timeout(50)
    assert len(pending_group_routes) == 1, "Group POST reached the controlled transport barrier"
    race_dialog.get_by_role("button", name="Cancel", exact=True).click()
    page.get_by_role("button", name="Replace file", exact=True).click()
    upload(page, "race-source-b.csv", config["raceB"])
    review(page)
    assert preview_requests[-1]["fileName"] == "race-source-b.csv"
    preview_count_before_release = len(preview_requests)
    with page.expect_response("**/api/groups", timeout=60000):
        pending_group_routes[0].continue_()
    page.unroute("**/api/groups", pause_group)
    page.wait_for_timeout(1500)
    revived = [request for request in preview_requests[preview_count_before_release:]
               if request["fileName"] == "race-source-a.csv"]
    assert not revived, "Late Group completion revived source A after source B was reviewed"
    expect(page.get_by_label("Import review rows")).to_contain_text("00000123805")
    assert len(preview_requests) == preview_count_before_release, "Late Group completion must not bump source B's review generation"
    print("Late Group completion preserves the replacement source and review generation.")
    if config["raceOnly"]:
        context.close()
        browser.close()
        sys.exit(0)
    page.get_by_role("button", name="Replace file", exact=True).click()
    upload(page, "broken.csv", "id,lastName\n123,Test\n")
    expect(page.get_by_role("button", name="Review import", exact=True)).to_be_disabled()
    expect(page.get_by_label("Import source").get_by_role("alert")).to_be_visible()
    page.get_by_role("button", name="Replace file", exact=True).click()
    upload(page, "invalid-year.csv", config["invalidYear"])
    review(page)
    expect(page.get_by_role("button", name="Review & confirm import", exact=True)).to_be_disabled()
    expect(page.get_by_label("Import review rows")).to_contain_text("yearLevel")
    expect(page.get_by_label("Import review rows").locator("input")).to_have_count(1)
    expect(page.get_by_label("Import review rows").get_by_label("Search import rows")).to_be_visible()
    page.get_by_role("button", name="Replace file", exact=True).click()
    upload(page, "mixed-browser.csv", config["mixed"])
    expect(page.get_by_text("broken.csv", exact=True)).to_have_count(0)
    review(page)
    page.get_by_role("button", name="Updates", exact=True).click()
    expect(page.get_by_label("Import review rows")).to_contain_text("firstName")
    expect(page.get_by_label("Import review rows")).to_contain_text("Browser Updated")
    page.get_by_role("button", name="Creates", exact=True).click()
    page.get_by_label("Search import rows").fill("00000123800")
    expect(page.get_by_label("Import review rows")).to_contain_text("00000123800")
    page.get_by_label("Search import rows").fill("")
    page.get_by_role("button", name="All", exact=True).click()
    expect(page.get_by_role("button", name="Review & confirm import", exact=True)).to_be_disabled()
    page.get_by_role("button", name="Create group browser-created", exact=True).click()
    group_dialog = page.get_by_role("dialog")
    expect(group_dialog).to_contain_text("Add group")
    expect(group_dialog.get_by_label("Slug", exact=True)).to_have_value("browser-created")
    group_dialog.get_by_label("Name", exact=True).fill("Browser Created Section")
    group_dialog.get_by_role("button", name="Create", exact=True).click()
    expect(page.get_by_role("button", name="Review & confirm import", exact=True)).to_be_enabled(timeout=60000)
    page.screenshot(path="/tmp/student-import-desktop-review.png", full_page=True)
    page.set_viewport_size({"width": 375, "height": 812})
    mobile_width(page)
    page.get_by_label("Search import rows").focus()
    page.keyboard.press("Tab")
    assert page.evaluate("document.activeElement !== document.body"), "keyboard navigation retains focus on a control"
    page.screenshot(path="/tmp/student-import-mobile-review.png", full_page=True)
    confirm(page)
    expect(page.get_by_role("heading", name="Import complete", exact=True)).to_be_visible(timeout=60000)
    expect(page.get_by_role("link", name="View students", exact=True)).to_be_visible()
    mobile_width(page)
    page.screenshot(path="/tmp/student-import-mobile-success.png", full_page=True)
    assert len(commit_requests) == 1, "one confirmed command was dispatched"

    page.get_by_role("button", name="Import another file", exact=True).click()
    upload(page, "stale-browser.csv", config["stale"])
    review(page)
    def stale_response(route):
        route.fulfill(status=409, content_type="application/json", body=json.dumps({"success": False, "code": "STALE_PREVIEW", "outcome": "REJECTED", "message": "The reviewed roster changed. Review the CSV again."}))
    page.route("**/api/students/imports/commit", stale_response)
    confirm(page)
    expect(page.get_by_role("alert").filter(has_text="reviewed roster changed")).to_be_visible(timeout=10000)
    expect(page.get_by_role("button", name="Review import", exact=True)).to_be_enabled()
    page.unroute("**/api/students/imports/commit", stale_response)
    page.get_by_role("button", name="Reset", exact=True).click()
    upload(page, "lost-response.csv", config["lost"])
    review(page)
    def lose_response(route):
        response = route.fetch(timeout=120000)
        assert response.status == 200, response.text()
        # Consume a committed real response, then simulate transport loss.
        route.abort("failed")
    page.route("**/api/students/imports/commit", lose_response)
    before_loss = len(commit_requests)
    confirm(page)
    expect(page.get_by_role("heading", name="Outcome unknown", exact=True)).to_be_visible(timeout=120000)
    expect(page.get_by_text(re.compile("may already have committed", re.I))).to_be_visible()
    expect(page.get_by_role("link", name="Review current roster", exact=True)).to_be_visible()
    page.wait_for_timeout(1500)
    assert len(commit_requests) == before_loss + 1, "unknown outcome never automatically retries"
    mobile_width(page)
    page.screenshot(path="/tmp/student-import-mobile-unknown.png", full_page=True)

    # Shared Settings form must retain its ordinary create/rename behavior.
    page.set_viewport_size({"width": 1440, "height": 1000})
    print("__SETTINGS_START__", flush=True)
    assert sys.stdin.readline().strip() == "ready"
    page.goto(base + "/settings#groups", wait_until="domcontentloaded")
    groups = page.locator("#groups")
    expect(groups.get_by_role("button", name="Add group", exact=True)).to_be_visible()
    groups.get_by_role("button", name="Add group", exact=True).click()
    settings_dialog = page.get_by_role("dialog")
    settings_dialog.get_by_label("Name", exact=True).fill("Ordinary Settings Section")
    expect(settings_dialog.get_by_label("Slug", exact=True)).to_have_value("ordinary-settings-section")
    expect(settings_dialog.get_by_role("combobox")).to_be_enabled()
    settings_dialog.get_by_role("combobox").click()
    page.get_by_role("option", name="SECTION", exact=True).click()
    settings_dialog.get_by_role("button", name="Create", exact=True).click()
    expect(groups.get_by_role("button", name="Rename Ordinary Settings Section", exact=True)).to_be_visible()
    groups.get_by_role("button", name="Rename Ordinary Settings Section", exact=True).click()
    settings_dialog = page.get_by_role("dialog")
    expect(settings_dialog.get_by_label("Slug", exact=True)).to_be_disabled()
    expect(settings_dialog.get_by_label("Slug", exact=True)).to_have_value("ordinary-settings-section")
    expect(settings_dialog.get_by_role("combobox")).to_have_count(0)
    expect(settings_dialog).to_contain_text("SECTION")
    settings_dialog.get_by_label("Name", exact=True).fill("Renamed Ordinary Section")
    settings_dialog.get_by_role("button", name="Save", exact=True).click()
    expect(groups.get_by_role("button", name="Rename Renamed Ordinary Section", exact=True)).to_be_visible()
    print("__SETTINGS_END__", flush=True)
    assert sys.stdin.readline().strip() == "ready"

    page.goto(base + "/students/import", wait_until="domcontentloaded")
    upload(page, "delayed-source-a.csv", config["raceB"])
    held_previews = []
    def hold_preview_response(route):
        response = route.fetch(timeout=60000)
        assert response.status == 200
        held_previews.append((route, response))
    page.route("**/api/students/imports/preview", hold_preview_response)
    page.get_by_role("button", name="Review import", exact=True).click()
    for attempt in range(100):
        if held_previews:
            break
        page.wait_for_timeout(50)
    assert len(held_previews) == 1, "authoritative review reached the delayed-response barrier"
    # Exercise the file-selection handler while an older response is held.
    # The chooser controls themselves disable ordinary concurrent interaction.
    upload(page, "delayed-source-b.csv", config["stale"])
    held_previews[0][0].fulfill(response=held_previews[0][1])
    page.unroute("**/api/students/imports/preview", hold_preview_response)
    page.wait_for_timeout(250)
    expect(page.get_by_text("delayed-source-b.csv", exact=True)).to_be_visible()
    expect(page.get_by_label("Import review rows")).to_have_count(0)
    review(page)
    expect(page.get_by_label("Import review rows")).to_contain_text("00000123802")
    page.get_by_role("button", name="Replace file", exact=True).click()
    upload(page, "account-switch.csv", config["stale"])
    held_previews.clear()
    page.route("**/api/students/imports/preview", hold_preview_response)
    page.get_by_role("button", name="Review import", exact=True).click()
    for attempt in range(100):
        if held_previews:
            break
        page.wait_for_timeout(50)
    assert len(held_previews) == 1
    page.get_by_role("button", name="Logout", exact=True).click()
    page.wait_for_url("**/login", timeout=60000)
    held_previews[0][0].fulfill(response=held_previews[0][1])
    page.unroute("**/api/students/imports/preview", hold_preview_response)
    page.wait_for_timeout(250)
    expect(page.get_by_label("Import review rows")).to_have_count(0)
    expect(page.get_by_text("account-switch.csv", exact=True)).to_have_count(0)
    context.close()
    browser.close()
    print("Import browser checks passed: keyboard native file selection, structural errors/replacement, filters/search/diffs, explicit Group/repreview, late Group source race, confirmation, known success, stale rejection UI, real post-commit response loss/no retry, Settings create/rename with zero Student writes, delayed response replacement/logout, keyboard and 375px width.")
`;

export async function runStudentImportBrowser({ base, cookie, toCsv, row, db }) {
  const input = {
    base, cookie,
    mixed: toCsv([row("00000123456", { firstName: "Browser Updated" }), row("00000123457"), row("00000123800"), row("00000123801", { section: "browser-created" })]),
    stale: toCsv([row("00000123802")]),
    lost: toCsv([row("00000123803")]),
    raceA: toCsv([row("00000123804", { section: "browser-race-created" })]),
    raceB: toCsv([row("00000123805")]),
    raceOnly: process.argv.includes("--browser-race"),
    large: toCsv(Array.from({ length: 2000 }, (_, index) => row(String(91000000000 + index)))),
    invalidYear: toCsv([row("00000123812", { yearLevel: "GRADE_11" })]),
  };
  const child = spawn("python3", ["-c", browserScript], { stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.write(JSON.stringify(input) + "\n");
  let output = "", errors = "";
  let lines = "", settingsWritesBefore, milestoneError;
  let milestones = Promise.resolve();
  child.stdout.on("data", (chunk) => {
    output += chunk; lines += chunk;
    while (lines.includes("\n")) {
      const end = lines.indexOf("\n"), line = lines.slice(0, end); lines = lines.slice(end + 1);
      if (!["__SETTINGS_START__", "__SETTINGS_END__"].includes(line)) continue;
      milestones = milestones.then(async () => {
        const result = await db.$queryRawUnsafe('SELECT COUNT(*)::int AS n FROM "ImportTestWrites"');
        if (line === "__SETTINGS_START__") settingsWritesBefore = result[0].n;
        else assert.equal(result[0].n, settingsWritesBefore, "Settings Group creation/rename caused zero Student writes");
        child.stdin.write("ready\n");
      }).catch((error) => { milestoneError = error; child.kill("SIGKILL"); });
    }
  });
  child.stderr.on("data", (chunk) => { errors += chunk; });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 240000);
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timeout));
  await milestones;
  if (milestoneError) throw milestoneError;
  // Python tracebacks contain UI assertions only, never auth values.
  assert.equal(code, 0, errors || output || "browser process failed");
  if (!input.raceOnly) {
    assert.equal(await db.student.count({ where: { id: "00000123803" } }), 1, "response-loss command committed exactly one new Student");
    assert.equal(await db.student.count({ where: { id: "00000123802" } }), 0, "simulated stale rejection never sent to mutation service");
  }
  assert.equal(await db.group.count({ where: { slug: "browser-race-created" } }), 1, "Group created for abandoned source remains durable");
  if (!input.raceOnly) {
    const settingsGroup = await db.group.findUnique({ where: { slug: "ordinary-settings-section" } });
    assert.equal(settingsGroup?.name, "Renamed Ordinary Section"); assert.equal(settingsGroup.category, "SECTION");
  }
  console.log(output.replace(/^__SETTINGS_(?:START|END)__\n/gm, "").trim());
}
