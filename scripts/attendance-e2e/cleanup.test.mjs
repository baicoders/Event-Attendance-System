import assert from "node:assert/strict";
import test from "node:test";
import { cleanupAll } from "./cleanup.mjs";

test("one cleanup failure does not prevent later resources being released", async () => {
  const released = [];
  await assert.rejects(cleanupAll([
    async () => { released.push("server"); throw new Error("server failure"); },
    async () => { released.push("pool"); },
    async () => { released.push("database"); },
    async () => { released.push("certificates"); },
  ]), /server failure/);
  assert.deepEqual(released, ["server", "pool", "database", "certificates"]);
});
