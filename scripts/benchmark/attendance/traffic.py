"""Short real-browser request-parity check; never runs during sustained measurements."""
import asyncio
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import async_playwright, expect

F = json.loads(Path(sys.argv[1]).read_text())
OUT = Path(F['artifacts'])
expect.set_options(timeout=30000)


async def main():
    evidence = []
    async with async_playwright() as p:
        args = ['--no-sandbox', '--ignore-certificate-errors-spki-list=' + F['pin']]
        renderer = await p.chromium.launch(executable_path=F['chrome'], args=args)
        page = await renderer.new_page(viewport={'width': 720, 'height': 720})
        await page.set_content('<body style="margin:0;background:white;display:flex;align-items:center;justify-content:center;height:720px">' + F['qr'] + '</body>')
        png, video = Path(F['scratch']) / 'card.png', Path(F['scratch']) / 'card.y4m'
        await page.screenshot(path=str(png))
        await renderer.close()
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-loop', '1', '-i', str(png), '-t', '1', '-r', '5', '-pix_fmt', 'yuv420p', '-threads', '1', str(video)], check=True, timeout=30)
        browser = await p.chromium.launch(executable_path=F['chrome'], args=args + ['--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + str(video)])
        try:
            for screen, event in F['events'].items():
                ctx = await browser.new_context(viewport={'width': 393, 'height': 851}, is_mobile=True, has_touch=True, permissions=['camera'])
                await ctx.tracing.start(screenshots=True, snapshots=True)
                requests, failures, camera_shutdown = [], [], []
                closing_camera = False
                external = []
                async def route_request(route):
                    if urlsplit(route.request.url).netloc != urlsplit(F['base']).netloc:
                        external.append(route.request.url)
                        await route.abort()
                    else:
                        await route.continue_()
                await ctx.route('**/*', route_request)
                page = await ctx.new_page()
                page.on('request', lambda req: requests.append({'method': req.method, 'url': req.url, 'body': req.post_data}) if '/api/' in req.url else None)
                def page_error(error):
                    message = str(error)
                    # Chromium can reject a pending play() when the operator explicitly
                    # removes the camera. Retain this diagnostic; unrelated errors fail.
                    if closing_camera and 'The play() request was interrupted because the media was removed from the document.' in message:
                        camera_shutdown.append(message)
                    else:
                        failures.append(message)
                page.on('pageerror', page_error)
                try:
                    await page.goto(F['base'] + '/login', timeout=60000)
                    await page.get_by_label('Email', exact=True).fill(F['email'])
                    await page.get_by_label('Password', exact=True).fill(F['password'])
                    await page.get_by_role('button', name='Sign in', exact=True).click()
                    await page.wait_for_url('**/dashboard', timeout=60000)
                    route = '/attendance/operator' if screen == 'operator' else '/attendance'
                    await page.goto(f"{F['base']}{route}?eventId={event}", timeout=60000)
                    await expect(page.get_by_role('button', name='Open Camera', exact=True)).to_be_visible()
                    await page.wait_for_timeout(9000)
                    initial = list(requests)
                    await page.get_by_role('button', name='Open Camera', exact=True).click()
                    await expect(page.get_by_text('Time-in recorded' if screen == 'operator' else 'RECORDED', exact=True).first).to_be_visible()
                    closing_camera = True
                    await page.get_by_role('button', name='Close camera', exact=True).first.click()
                    await page.wait_for_timeout(250)
                    closing_camera = False
                    if screen == 'operator':
                        await page.get_by_role('button', name='Manual entry', exact=True).first.click()
                    search = page.get_by_label('Search name, USN or LRN')
                    await search.fill(F['manual']['usn'])
                    async with page.expect_response(lambda res: res.request.method == 'GET' and '/api/records?' in res.url and F['manual']['id'] in res.url):
                        await page.get_by_role('button', name=re.compile('^View details for Rehearsal Student0002,')).click()
                    button = page.get_by_role('button', name='Record time in', exact=True)
                    await expect(button).to_be_enabled()
                    before_manual_write = len(requests)
                    async with page.expect_response(lambda res: res.request.method == 'POST' and res.url.endswith('/api/records')) as response:
                        await button.click()
                    assert (await response.value).ok
                    await page.wait_for_timeout(1500)
                    after_manual = [urlsplit(req['url']).path + ('?' + urlsplit(req['url']).query if urlsplit(req['url']).query else '')
                                    for req in requests[before_manual_write:] if req['method'] == 'GET']
                    for refreshed in [f'/api/events/{event}/stats', f'/api/events/{event}/records?includeWithoutTimeIn=true',
                                      f"/api/records?eventId={event}&studentId={F['manual']['id']}"]:
                        assert refreshed in after_manual, f'{screen}: missing active-query refresh after manual save: {refreshed}'
                    paths = [urlsplit(req['url']).path + ('?' + urlsplit(req['url']).query if urlsplit(req['url']).query else '') for req in initial]
                    required = [f'/api/events/{event}', f'/api/events/{event}/stats']
                    for path in required:
                        assert paths.count(path) >= 2, f'{screen}: expected initial read and 8-second poll: {path}'
                    if screen == 'regular':
                        assert f'/api/events/{event}/records' in paths
                        assert f'/api/events/{event}/records?includeWithoutTimeIn=true' in paths
                        assert f'/api/students?eventId={event}' in paths
                    else:
                        assert not any(f'/api/events/{event}/records' in path for path in paths), 'Closed manual panel unexpectedly fetches full records'
                    writes = [json.loads(req['body']) for req in requests if req['method'] == 'POST' and urlsplit(req['url']).path == '/api/records']
                    assert {write['method'] for write in writes} == {'SCANNED', 'MANUAL'}
                    assert len(writes) == 2
                    assert not failures, failures
                    assert not external, external
                    evidence.append({'screen': screen, 'passed': True, 'requests': requests, 'initialRequests': initial, 'externalRequests': external,
                                     'cameraShutdownDiagnostics': camera_shutdown})
                    await page.screenshot(path=str(OUT / f'traffic-{screen}.png'), full_page=True)
                finally:
                    await ctx.tracing.stop(path=str(OUT / f'traffic-{screen}.trace.zip'))
                    await ctx.close()
        finally:
            await browser.close()
    (OUT / 'browser-traffic.json').write_text(json.dumps(evidence, indent=2))


asyncio.run(main())
