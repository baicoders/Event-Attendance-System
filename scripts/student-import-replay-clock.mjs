/** Isolated real-PG service probe: expired exact replay must perform no roster
 * reads/writes. Invoked by test-student-import.mjs, never against a live DB.
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
const url = process.env.DATABASE_URL;
assert.ok(url && /^test_[a-z0-9_]+$/.test(new URL(url).pathname.slice(1)), "probe requires the explicit disposable database URL");
let text = "";
for await (const chunk of process.stdin) text += chunk;
const { command, actor, expectedReceipt, now } = JSON.parse(text);
const pool = new Pool({ connectionString: url });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });
const serviceModule = await import("../features/students/import/server.ts");
const { commitStudentImport } = serviceModule.default ?? serviceModule;
const realNow = Date.now;
let forbiddenRosterOperations = 0;
const guarded = new Proxy(db, {
  get(target, property) {
    if (property !== "$transaction") return Reflect.get(target, property);
    return (work, options) => target.$transaction((tx) => work(new Proxy(tx, {
      get(transaction, model) {
        if (["student", "group"].includes(model)) return new Proxy(transaction[model], {
          get() { return () => { forbiddenRosterOperations++; throw new Error("Exact replay attempted a forbidden Student/Group operation"); }; },
        });
        return Reflect.get(transaction, model);
      },
    })), options);
  },
});
try {
  Date.now = () => now;
  const result = await commitStudentImport(guarded, command, actor);
  assert.equal(result.replayed, true); assert.deepEqual(result.receipt, expectedReceipt);
  assert.equal(forbiddenRosterOperations, 0);
  console.log(JSON.stringify({ replayed: true, receiptId: result.receipt.id, expiredPreview: true, forbiddenRosterOperations }));
} finally {
  Date.now = realNow; await db.$disconnect(); await pool.end();
}
