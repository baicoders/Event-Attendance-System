/** Local-only USWAG seed. No dotenv import and no environment connection fallback. */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { takeRosterExclusiveLock } from "../../globals/utils/pgLocks";
import { EXPECTED, Group, Membership, Participant, Student, reconcile, validateLocalDatabaseUrl } from "./reconcile";

const USAGE = `Usage: node --import tsx scripts/uswag/seed.ts --database-url <LOCAL-postgresql-url>
  [--workbook 'USWAG ATTENDANCE.xlsx'] [--report /tmp/private-report.json]
  [--apply --approval-report /tmp/reviewed-dry-run.json]
Default: read-only dry-run. Review the private report before explicitly applying it.
No students, academic memberships, or attendance records are created or modified.`;

type Options = {databaseUrl: string; workbook: string; report?: string; apply: boolean; approvalReport?: string};
function parseArgs(argv: string[]): Options {
  const options: Options = {databaseUrl: "", workbook: "USWAG ATTENDANCE.xlsx", apply: false};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") { /* dry-run is already the default */ }
    else if (["--database-url", "--workbook", "--report", "--approval-report"].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (arg === "--database-url") options.databaseUrl = value;
      if (arg === "--workbook") options.workbook = value;
      if (arg === "--report") options.report = value;
      if (arg === "--approval-report") options.approvalReport = value;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  validateLocalDatabaseUrl(options.databaseUrl);
  if (options.apply && argv.includes("--dry-run")) throw new Error("Choose either --apply or --dry-run.");
  if (options.apply && !options.approvalReport) throw new Error("--apply requires --approval-report from a reviewed dry-run. Review the planned assignments before writing.");
  return options;
}
function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
function queryAdapter(client: Client) {
  const query = (strings: TemplateStringsArray, ...values: unknown[]) => client.query(strings.reduce((sql, part, index) => sql + (index ? `$${index}` : "") + part, ""), values);
  return {$queryRaw: query, $executeRaw: query};
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {console.log(USAGE); return;}
  const options = parseArgs(process.argv.slice(2));
  const expectedDatabase = validateLocalDatabaseUrl(options.databaseUrl);
  const workbookPath = resolve(options.workbook);
  const workbookHash = sha256(readFileSync(workbookPath));
  const parser = join(dirname(fileURLToPath(import.meta.url)), "read-workbook.py");
  const workbook = JSON.parse(execFileSync("python3", [parser, workbookPath], {encoding: "utf8", maxBuffer: 8 * 1024 * 1024})) as {expected: typeof EXPECTED; participants: Participant[]};
  // Guard the JS boundary too; parser changes cannot silently relax expected counts.
  if (JSON.stringify(workbook.expected) !== JSON.stringify(EXPECTED) || workbook.participants.length !== 95) throw new Error("Unexpected workbook counts.");
  if (workbook.participants.some(participant => (participant.position?.length ?? 0) > 160)) throw new Error("Workbook positions exceed the membership field's 160 character limit.");
  const reportPath = options.report ? resolve(options.report) : join(mkdtempSync(join(tmpdir(), "uswag-reconciliation-")), "report.json");
  // Reserve a private new file before any possible writes. Never overwrite a reviewed report.
  writeFileSync(reportPath, "", {flag: "wx", mode: 0o600});
  const client = new Client({connectionString: options.databaseUrl, connectionTimeoutMillis: 5000});
  let transaction = false;
  try {
    await client.connect();
    await client.query(options.apply ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transaction = true;
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    if (options.apply) await takeRosterExclusiveLock(queryAdapter(client));
    const identity = (await client.query<{database: string; serverAddress: string; serverPort: number}>(`SELECT current_database() AS database, inet_server_addr()::text AS "serverAddress", inet_server_port() AS "serverPort"`)).rows[0];
    const peer = (client as unknown as {connection: {stream: {remoteAddress?: string; remotePort?: number}}}).connection.stream;
    if (identity.database !== expectedDatabase.database || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer.remoteAddress ?? "") || peer.remotePort !== expectedDatabase.port) throw new Error("Connected database is not the requested local database/endpoint. Refusing to continue.");
    // The socket peer must be the requested loopback endpoint. PostgreSQL's own
    // inet_server_addr/port may be a container address behind that local port.
    const students = (await client.query<Student>('SELECT id, "firstName", "middleName", "lastName" FROM "Student" ORDER BY id')).rows;
    const groups = (await client.query<Group>('SELECT id, name, slug, category FROM "Group" ORDER BY id')).rows;
    const memberships = (await client.query<Membership>('SELECT m."studentId", m."groupId", m.position, g.name AS "groupName" FROM "CustomGroupMembership" m JOIN "Group" g ON g.id = m."groupId" ORDER BY m."studentId"')).rows;
    const plan = reconcile(workbook.participants, students, memberships, groups);
    const target = {database: identity.database, host: expectedDatabase.host, port: expectedDatabase.port};
    const fingerprint = sha256(JSON.stringify({workbookHash, target, plan}));
    let applied = 0;
    if (options.apply) {
      const approved = JSON.parse(readFileSync(resolve(options.approvalReport!), "utf8")) as {mode?: string; fingerprint?: string};
      if (approved.mode !== "dry-run" || approved.fingerprint !== fingerprint) throw new Error("Reviewed dry-run no longer matches the workbook/database plan. Run and review a fresh dry-run; nothing was applied.");
      if (plan.groups.some(group => group.action === "conflict")) throw new Error("A group name/slug conflict requires manual resolution before applying; nothing was applied.");
      const groupIds = new Map<string, string>();
      for (const group of plan.groups) {
        const id = group.id ?? randomUUID();
        if (!group.id) await client.query('INSERT INTO "Group" (id, name, slug, category, "createdAt", "updatedAt") VALUES ($1, $2, $3, \'CUSTOM\', now(), now())', [id, group.name, group.slug]);
        groupIds.set(group.name, id);
      }
      // All classifications happened under the same exclusive roster lock before writing.
      for (const assignment of plan.assignments) {
        const groupId = groupIds.get(assignment.group)!;
        if (assignment.action === "set-position") {
          const result = await client.query('UPDATE "CustomGroupMembership" SET position = $1, "updatedAt" = now() WHERE "studentId" = $2 AND "groupId" = $3 AND (position IS NULL OR position = \'\')', [assignment.position, assignment.studentId, groupId]);
          if (result.rowCount !== 1) throw new Error("Membership changed during apply; rolling back every write.");
        } else {
          // Unique studentId constraint is the final guard against uncoordinated writers.
          await client.query('INSERT INTO "CustomGroupMembership" ("studentId", "groupId", position, "createdAt", "updatedAt") VALUES ($1, $2, $3, now(), now())', [assignment.studentId, groupId, assignment.position]);
        }
        applied++;
      }
    }
    await client.query("COMMIT");
    transaction = false;
    const report = {mode: options.apply ? "apply" : "dry-run", generatedAt: new Date().toISOString(), database: target, workbook: {path: workbookPath, sha256: workbookHash, expected: workbook.expected}, fingerprint, ...plan, counts: {...plan.counts, successfullyAppliedAssignments: applied}, groupCounts: Object.entries(EXPECTED).map(([group, expected]) => ({group, expected, matched: plan.details.filter(detail => detail.group === group && detail.match === "matched").length, planned: plan.assignments.filter(assignment => assignment.group === group).length}))};
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", {mode: 0o600});
    console.log(JSON.stringify({mode: report.mode, database: target, studentRecords: students.length, counts: report.counts, groupCounts: report.groupCounts, report: reportPath}, null, 2));
    if (!options.apply) console.log("No database writes performed. Review the private report's assignments and unresolved rows before explicitly applying it.");
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
main().catch(error => {console.error(error instanceof Error ? error.message : "USWAG reconciliation failed."); process.exitCode = 1;});
