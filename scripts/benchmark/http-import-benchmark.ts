/** Reviewed import HTTP benchmark. Always provisions a disposable PostgreSQL
 * database and starts the production app against it; never uses school data.
 * Run pnpm build first, then pnpm benchmark:import.
 */
import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['--import','tsx','scripts/test-student-import.mjs','--large'], {stdio:'inherit',env:process.env});
if (result.error) throw result.error;
process.exitCode=result.status ?? 1;
