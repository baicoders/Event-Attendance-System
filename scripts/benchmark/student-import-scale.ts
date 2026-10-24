/** Real import service benchmark on synthetic, disposable PostgreSQL databases.
 * node --conditions=react-server --import tsx scripts/benchmark/student-import-scale.ts
 * Requires TEST_DATABASE_URL; never writes to DATABASE_URL or enrollment files.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cpus, platform, release, totalmem } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Prisma, PrismaClient, SchoolLevel, YearLevel } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { createDisposableDb } from '../../globals/libs/testDb';
import { prepareImport, readImportState, previewStudentImport, commitStudentImport } from '../../features/students/import/server';
import { classifyStudentImport } from '../../features/students/import/classify';
import { DEFAULT_IMPORT_BATCH_SIZE } from '../../features/students/import/writeBatches';

type QueryObservation = { sql: string; durationMs: number; observedAt: number };
type Progress = { processed: number; total: number; batch: number; batches: number };
const round = (value: number) => Math.round(value * 100) / 100;
const mib = (bytes: number) => round(bytes / 1024 ** 2);
const results: Record<string, unknown>[] = [];
let postgresVersion = '';
const configuration = {
  measuredAt: new Date().toISOString(), node: process.version, platform: `${platform()} ${release()}`,
  cpu: cpus()[0]?.model, logicalCpus: cpus().length, hostMemoryMiB: mib(totalmem()),
  databaseNetwork: ['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.TEST_DATABASE_URL ?? 'postgresql://not-configured').hostname)
    ? 'Local TCP PostgreSQL; no induced latency' : 'Remote TCP PostgreSQL; host redacted; no induced latency',
  importPoolMax: 2, observerPoolMax: 1, sampleIntervalMs: 20, batchSize: DEFAULT_IMPORT_BATCH_SIZE,
  memoryObservation: 'Sampled RSS may miss synchronous peaks. processLifetimeHighWaterRssMiB is the OS high-water RSS since process start (including setup and previous sizes), from process.resourceUsage().maxRSS on Linux.',
};

async function main() {
for (const count of [1000, 3000, 5000, 10000]) {
  const fixture = await createDisposableDb('test_import_scale');
  const pool = new Pool({ connectionString: fixture.url, max: 2, application_name: 'import-scale-app' });
  const observer = new Pool({ connectionString: fixture.url, max: 1, application_name: 'import-scale-observer' });
  const db = new PrismaClient({ adapter: new PrismaPg(pool), log: [{ emit: 'event', level: 'query' }] });
  const queries: QueryObservation[] = [];
  db.$on('query', event => queries.push({ sql: event.query, durationMs: event.duration, observedAt: performance.now() }));
  let timer: ReturnType<typeof setInterval> | undefined;
  let sampling: Promise<void> | undefined;
  let peakRss = process.memoryUsage().rss;
  let peakPoolConnections = 0;
  let peakActiveConnections = 0;
  let samples = 0;
  let sampleFailure: unknown;
  try {
    postgresVersion = (await observer.query('SELECT version() AS version')).rows[0].version;
    const actor = await db.user.create({ data: { name: 'Synthetic Administrator', email: 'scale@example.test', password: 'fixture-unused', role: 'ADMIN', status: 'ACTIVE' } });
    const groups = [
      { id: 'blue', slug: 'blue', name: 'Blue', category: 'HOUSE' },
      { id: 'red', slug: 'red', name: 'Red', category: 'HOUSE' },
      { id: 'section-a', slug: 'section-a', name: 'Section A', category: 'SECTION' },
      { id: 'bsit', slug: 'bsit', name: 'BSIT', category: 'PROGRAM' },
      { id: 'cs', slug: 'cs', name: 'Computer Studies', category: 'DEPARTMENT' },
      { id: 'stem', slug: 'stem', name: 'STEM', category: 'STRAND' },
      { id: 'guild', slug: 'guild', name: 'Synthetic Guild', category: 'CUSTOM' },
    ] satisfies Prisma.GroupCreateManyInput[];
    await db.group.createMany({ data: groups });
    const existingCount = count / 2;
    const identifiers = (index: number) => ({ usn: String(20000000000 + index), lrn: String(100000000000 + index) });
    const academics = (index: number) => index % 3 === 1
      ? { schoolLevel: SchoolLevel.SHS, yearLevel: YearLevel.GRADE_11 }
      : { schoolLevel: SchoolLevel.COLLEGE, yearLevel: YearLevel.YEAR_1 };
    const seeds = Array.from({ length: existingCount }, (_, index) => ({
      id: `synthetic-existing-${index}`, firstName: `Synthetic${index}`, lastName: 'Student', middleName: 'Retained',
      ...academics(index), usn: index % 3 === 1 ? null : identifiers(index).usn,
      lrn: index % 3 === 1 || (index % 3 === 2 && index % 2 === 1) ? identifiers(index).lrn : null,
    }));
    for (let offset = 0; offset < seeds.length; offset += 500) await db.student.createMany({ data: seeds.slice(offset, offset + 500) });
    const memberships = seeds.flatMap((student, index) => ['blue', 'section-a', ...(index % 3 === 1 ? ['stem'] : ['bsit', 'cs'])].map(groupId => ({ groupId, studentId: student.id })));
    await db.$executeRaw(Prisma.sql`INSERT INTO "_GroupToStudent" ("A", "B") SELECT v."groupId",v."studentId" FROM jsonb_to_recordset(${JSON.stringify(memberships)}::jsonb) AS v("groupId" text,"studentId" text)`);
    await db.customGroupMembership.create({ data: { studentId: seeds[0].id, groupId: 'guild', position: 'Treasurer' } });
    const event = await db.event.create({ data: { title: 'Synthetic scale event', category: 'ALL', start: new Date(), end: new Date() } });
    const attendance = await db.record.create({ data: { eventId: event.id, studentId: seeds[0].id, method: 'SCANNED', timein: new Date() } });
    const before = await db.student.findMany({ orderBy: { id: 'asc' }, select: { id: true, createdAt: true, updatedAt: true } });
    const beforeById = new Map(before.map(student => [student.id, student]));
    const header = 'usn,lrn,firstName,lastName,middleName,schoolLevel,yearLevel,section,house,program,department,strand';
    const csv = header + '\n' + Array.from({ length: count }, (_, index) => {
      const current = index < existingCount;
      const shs = index % 3 === 1;
      const { usn, lrn } = identifiers(index);
      const academic = academics(index);
      return [shs ? '' : usn, shs || index % 3 === 2 ? lrn : '', `Synthetic${index}`, 'Student', '',
        current ? '' : academic.schoolLevel, current ? '' : academic.yearLevel,
        current || index % 5 === 0 ? '' : 'section-a', current ? (index % 2 === 0 ? 'red' : '') : 'blue',
        current || shs ? '' : 'bsit', current || shs ? '' : 'cs', current || !shs ? '' : 'stem'].join(',');
    }).join('\n');
    const input = { v: 2 as const, fileName: `synthetic-${count}.csv`, sourceHash: createHash('sha256').update(csv).digest('hex'), csv };
    const initialRss = process.memoryUsage().rss;
    peakRss = initialRss;
    const sample = () => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      peakPoolConnections = Math.max(peakPoolConnections, pool.totalCount);
      if (sampling) return;
      sampling = observer.query("SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name='import-scale-app' AND state='active'")
        .then(result => { peakActiveConnections = Math.max(peakActiveConnections, result.rows[0].n); samples++; })
        .catch(error => { sampleFailure = error; })
        .finally(() => { sampling = undefined; });
    };
    timer = setInterval(sample, 20); sample();
    let start = performance.now();
    const prepared = prepareImport(input);
    const parsingAndHashMs = performance.now() - start;
    queries.length = 0;
    start = performance.now();
    const state = await db.$transaction(tx => readImportState(tx, prepared.rows));
    const isolatedStateReadMs = performance.now() - start;
    const isolatedStateQueries = queries.length;
    start = performance.now();
    const classified = classifyStudentImport({ ...state, rows: prepared.rows });
    const isolatedClassificationMs = performance.now() - start;
    assert.deepEqual(classified.counts, { total: count, create: existingCount, update: existingCount / 2, unchanged: existingCount / 2, blocked: 0 });
    queries.length = 0;
    start = performance.now();
    const preview = await previewStudentImport(db, input, actor);
    const previewMs = performance.now() - start;
    const previewQueries = queries.length;
    assert.deepEqual(preview.counts, classified.counts);
    assert.ok(preview.previewToken);
    const command = { ...input, previewToken: preview.previewToken, commandId: randomUUID() };
    queries.length = 0;
    const progress: Array<Progress & { observedAt: number }> = [];
    start = performance.now();
    const committed = await commitStudentImport(db, command, actor, (value: Progress) => progress.push({ ...value, observedAt: performance.now() }));
    const commitMs = performance.now() - start;
    const commitQueries = [...queries];
    assert.equal(committed.replayed, false);
    assert.deepEqual(committed.receipt.counts, classified.counts);
    assert.ok(progress.length > 0);
    assert.equal(progress.at(-1)?.processed, count);
    assert.equal(progress.at(-1)?.total, count);
    for (const [index, entry] of progress.entries()) {
      assert.ok(entry.processed <= count && entry.processed >= (progress[index - 1]?.processed ?? 0));
      assert.equal(entry.total, count);
    }
    queries.length = 0;
    start = performance.now();
    const replayed = await commitStudentImport(db, command, actor);
    const exactReplayMs = performance.now() - start;
    const exactReplayQueries = queries.length;
    assert.equal(replayed.replayed, true);
    assert.deepEqual(replayed.receipt, committed.receipt);
    assert.ok(queries.every(query => !/\b(?:INSERT|UPDATE|DELETE)\b/i.test(query.sql)), 'Exact replay must execute zero writes');
    const repeated = await previewStudentImport(db, input, actor);
    assert.deepEqual(repeated.counts, { total: count, create: 0, update: 0, unchanged: count, blocked: 0 });
    clearInterval(timer); timer = undefined; await sampling;
    assert.equal(sampleFailure, undefined);
    assert.ok(peakPoolConnections <= 2);
    assert.ok(peakActiveConnections <= 2);
    const saved = await db.student.findMany({ include: { groups: true } });
    assert.equal(saved.length, count);
    assert.equal(new Set(saved.map(student => student.id)).size, count);
    assert.equal(new Set(saved.filter(student => student.usn).map(student => student.usn)).size, saved.filter(student => student.usn).length);
    assert.equal(new Set(saved.filter(student => student.lrn).map(student => student.lrn)).size, saved.filter(student => student.lrn).length);
    const savedById = new Map(saved.map(student => [student.id, student]));
    for (let index = 0; index < existingCount; index++) {
      const student = savedById.get(seeds[index].id)!;
      assert.ok(student, 'Stable existing QR/internal ID must remain present');
      assert.equal(student.middleName, 'Retained');
      assert.equal(student.schoolLevel, seeds[index].schoolLevel);
      assert.equal(student.yearLevel, seeds[index].yearLevel);
      const expectedGroups = [index % 2 === 0 ? 'red' : 'blue', 'section-a', ...(index % 3 === 1 ? ['stem'] : ['bsit', 'cs'])].sort();
      assert.deepEqual(student.groups.map(group => group.id).sort(), expectedGroups);
      assert.deepEqual(student.createdAt, beforeById.get(student.id)!.createdAt);
      if (index % 2 === 1) assert.deepEqual(student.updatedAt, beforeById.get(student.id)!.updatedAt, 'Unchanged timestamps must not move');
    }
    assert.deepEqual(await db.record.findUniqueOrThrow({ where: { id: attendance.id } }), attendance);
    const retainedCustom = await db.customGroupMembership.findUniqueOrThrow({ where: { studentId_groupId: { studentId: seeds[0].id, groupId: 'guild' } } });
    assert.equal(retainedCustom.position, 'Treasurer');
    assert.equal(await db.studentImportBatch.count(), 1);
    const writes = commitQueries.filter(query => /^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(query.sql));
    const firstStudentWrite = writes.find(query => /"Student"/.test(query.sql));
    const writeStart = firstStudentWrite ? firstStudentWrite.observedAt - firstStudentWrite.durationMs : 0;
    const workProgress = progress.filter(entry => entry.batch > 0);
    const batchIntervals = workProgress.map((entry, index) => round(entry.observedAt - (index === 0 ? writeStart : workProgress[index - 1].observedAt)));
    const result = {
      rows: count, counts: classified.counts, csvBytes: Buffer.byteLength(csv),
      parsingAndHashMs: round(parsingAndHashMs), isolatedStateReadMs: round(isolatedStateReadMs), isolatedClassificationMs: round(isolatedClassificationMs), isolatedStateQueries,
      previewMs: round(previewMs), previewQueries, commitMs: round(commitMs), commitQueries: commitQueries.length,
      writeQueries: writes.length, writeSqlDurationMs: round(writes.reduce((sum, query) => sum + query.durationMs, 0)),
      tentativeBatchIntervalsMs: batchIntervals, peakRssMiB: mib(peakRss), processLifetimeHighWaterRssMiB: mib(process.resourceUsage().maxRSS * 1024), initialRssMiB: mib(initialRss), sampledRssIncreaseMiB: mib(peakRss - initialRss),
      peakPoolConnections, peakActiveConnections, samples, exactReplayMs: round(exactReplayMs), exactReplayQueries,
      assertions: 'Exact counts, repeated preview unchanged, exact replay zero writes, stable existing IDs/timestamps/academic groups, attendance and custom position retained; unique USN/LRN; one receipt',
    };
    results.push(result);
    console.log(JSON.stringify(result));
  } finally {
    if (timer) clearInterval(timer);
    await sampling;
    await db.$disconnect(); await pool.end(); await observer.end(); await fixture.cleanup();
  }
}

mkdirSync('docs/verification', { recursive: true });
const environment = { ...configuration, postgresVersion };
const table = results.map(result => `| ${result.rows} | ${result.previewMs} | ${result.commitMs} | ${result.commitQueries} | ${result.peakRssMiB} | ${result.peakPoolConnections} |`).join('\n');
writeFileSync('docs/verification/student-import-scale.md', `# Synthetic student import service scale evidence\n\nRun: \`node --conditions=react-server --import tsx scripts/benchmark/student-import-scale.ts\`.\n\nEach size provisions and drops its own migrated \`test_import_scale_*\` PostgreSQL database through TEST_DATABASE_URL. No production or enrollment data is used. Dataset: 50% new, 25% safely updated academic/identifier information, 25% unchanged; USN-only college, LRN-only SHS, and dual identifiers. Existing blank optional cells preserve academic values, house/section, middle name, custom Treasurer membership, attendance and internal QR IDs.\n\n| Rows | Preview ms | Commit ms | Commit queries | Sampled peak process RSS MiB | Peak importer pool connections |\n| ---: | ---: | ---: | ---: | ---: | ---: |\n${table}\n\nThis exercises the real parser/classifier/preview/commit/receipt service and PostgreSQL adapter; it is not an HTTP/browser end-to-end test. PostgreSQL uses the explicitly configured test connection (no injected latency). Durations include development-host scheduling and local contention; they are not production capacity promises. Setup/migrations/verification reads are excluded from preview/commit times. Query counts come from Prisma query events and include transaction/control/state/receipt statements. Write SQL duration sums only INSERT/UPDATE/DELETE query events and is not the whole commit duration. Parsing+hash and classification/state timings are additional isolated passes, not additive components of measured service time. Tentative batch intervals start at the first observed Student SQL write (first event end minus its duration), then use actual progress callbacks; they include inter-statement JavaScript work and exclude final receipt/COMMIT. All progress remains tentative until the transaction commits.\n\nRSS and database activity are sampled every 20 ms with no overlapping observer query; synchronous JavaScript can delay sampling, so reported peaks are sampled lower bounds, not hard ceilings. Process RSS includes the harness, synthetic datasets, prior-size heap retention and service; it excludes PostgreSQL memory. Import pool is configured to at most two connections, observer has a separate one-connection pool. Active importer backend count comes from pg_stat_activity. No baseline comparison is fabricated; previous documented HTTP-only measurements have a different workload/environment.\n\nEnvironment:\n\n\`\`\`json\n${JSON.stringify(environment, null, 2)}\n\`\`\`\n\nRaw measured results:\n\n\`\`\`json\n${JSON.stringify(results, null, 2)}\n\`\`\`\n`);
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
