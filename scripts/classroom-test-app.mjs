import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { createDisposableDatabase } from './pg-test-db.mjs';

export async function withClassroomTestApp(run) {
  const disposable = await createDisposableDatabase();
  const pool = new Pool({ connectionString: disposable.url, max: 8 });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const port = 43000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  mkdirSync('.superpowers/classroom-tests', { recursive: true });
  const testConfig = `.superpowers/classroom-tests/tsconfig-${port}.json`;
  writeFileSync(testConfig, JSON.stringify({ extends: '../../tsconfig.json', compilerOptions: { baseUrl: '../..' }, include: ['../../next-env.d.ts', '../../**/*.ts', '../../**/*.tsx'], exclude: ['../../node_modules', '../../.superpowers'] }));
  const fd = openSync(`.superpowers/classroom-tests/api-${port}.log`, 'w');
  let server;
  const development = process.env.CLASSROOM_TEST_DEV === 'true';
  const request = async (path, { method = 'GET', body, cookie, headers = {}, redirect = 'manual' } = {}) => {
    const response = await fetch(`${base}${path}`, { method, redirect, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json', origin: base } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }
    return { response, json, text, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  try {
    server = spawn('pnpm', development ? ['exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)] : ['start', '--hostname', '127.0.0.1', '--port', String(port)], { detached: true, env: { ...process.env, DATABASE_URL: disposable.url, DIRECT_URL: disposable.url, AUTH_SECRET: 'classroom-api-test-only-private-secret', CLASSROOM_ENABLED: 'true', APP_ORIGINS: base, ...(development ? { USWAG_TEST_DIST_DIR: `.superpowers/classroom-tests/next-${port}`, USWAG_TEST_TSCONFIG: testConfig } : {}) }, stdio: ['ignore', fd, fd] });
    let ready = false;
    for (let i = 0; i < 180; i++) {
      try { const r = await request('/api/auth/session'); if (r.response.status === 200) { ready = true; break; } } catch {}
      if (server.exitCode !== null || server.signalCode !== null) throw new Error('Test app exited before ready. Inspect .superpowers/classroom-tests logs.');
      await delay(500);
    }
    if (!ready) throw new Error('Test app did not become ready.');
    await run({ db, base, request });
  } finally {
    if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
    closeSync(fd);
    await db.$disconnect(); await pool.end(); await disposable.cleanup();
  }
}
