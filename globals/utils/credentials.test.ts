import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAdminPasswordReset,
  applyLegacyPasswordUpgrade,
  applyOwnPasswordChange,
  generateTemporaryPassword,
  TEMP_PASSWORD_ALPHABET,
  TEMP_PASSWORD_LENGTH,
  type CredentialDb,
} from "./credentials";

type Row = {
  id: string;
  password: string;
  credentialVersion: number;
  status: string;
  role: string;
  mustChangePassword: boolean;
  name: string;
  email: string;
};

/** Minimal in-memory stand-in for the Prisma user delegate. */
function fakeDb(initial: Row[]): { db: CredentialDb; rows: Map<string, Row> } {
  const rows = new Map(initial.map((r) => [r.id, { ...r }]));
  const matches = (row: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) => {
      const current = (row as unknown as Record<string, unknown>)[key];
      if (
        value !== null &&
        typeof value === "object" &&
        "increment" in (value as Record<string, unknown>)
      ) {
        throw new Error("increment is not a where condition");
      }
      return current === value;
    });

  const db: CredentialDb = {
    user: {
      async updateMany({ where, data }) {
        let count = 0;
        for (const row of rows.values()) {
          if (!matches(row, where)) continue;
          count += 1;
          for (const [key, value] of Object.entries(data)) {
            if (
              value !== null &&
              typeof value === "object" &&
              "increment" in (value as Record<string, unknown>)
            ) {
              const n = (value as { increment: number }).increment;
              (row as unknown as Record<string, unknown>)[key] =
                ((row as unknown as Record<string, unknown>)[key] as number) +
                n;
            } else {
              (row as unknown as Record<string, unknown>)[key] = value;
            }
          }
        }
        return { count };
      },
      async findUnique({ where }) {
        const row = rows.get(where.id as string) ?? null;
        return row ? { ...row } : null;
      },
    },
  };
  return { db, rows };
}

const user = (overrides: Partial<Row> = {}): Row => ({
  id: "u1",
  password: "hash-v0",
  credentialVersion: 0,
  status: "ACTIVE",
  role: "ORGANIZER",
  mustChangePassword: false,
  name: "Maria Santos",
  email: "maria@example.edu",
  ...overrides,
});

test("temporary passwords keep the established alphabet and length", () => {
  for (let i = 0; i < 100; i++) {
    const password = generateTemporaryPassword();
    assert.equal(password.length, TEMP_PASSWORD_LENGTH);
    for (const char of password) {
      assert.ok(
        TEMP_PASSWORD_ALPHABET.includes(char),
        `unexpected character ${char}`,
      );
    }
  }
});

test("own change commits only against the verified version, hash, and ACTIVE status", async () => {
  const { db, rows } = fakeDb([user()]);
  const updated = await applyOwnPasswordChange(db, {
    userId: "u1",
    expectedCredentialVersion: 0,
    verifiedPasswordHash: "hash-v0",
    newPasswordHash: "hash-v1",
  });
  assert.ok(updated);
  assert.equal(updated.credentialVersion, 1);
  assert.equal(updated.mustChangePassword, false);
  assert.equal(rows.get("u1")?.password, "hash-v1");
});

test("own change loses to a newer reset instead of overwriting it", async () => {
  const { db, rows } = fakeDb([user({ password: "hash-v1", credentialVersion: 1, mustChangePassword: true })]);
  const updated = await applyOwnPasswordChange(db, {
    userId: "u1",
    expectedCredentialVersion: 0,
    verifiedPasswordHash: "hash-v0",
    newPasswordHash: "hash-stale",
  });
  assert.equal(updated, null);
  assert.equal(rows.get("u1")?.password, "hash-v1");
  assert.equal(rows.get("u1")?.credentialVersion, 1);
  assert.equal(rows.get("u1")?.mustChangePassword, true);
});

test("own change refuses a wrong current password and a non-ACTIVE account", async () => {
  const { db } = fakeDb([user()]);
  assert.equal(
    await applyOwnPasswordChange(db, {
      userId: "u1",
      expectedCredentialVersion: 0,
      verifiedPasswordHash: "wrong-hash",
      newPasswordHash: "hash-v1",
    }),
    null,
  );
  const { db: suspended } = fakeDb([user({ status: "REJECTED" })]);
  assert.equal(
    await applyOwnPasswordChange(suspended, {
      userId: "u1",
      expectedCredentialVersion: 0,
      verifiedPasswordHash: "hash-v0",
      newPasswordHash: "hash-v1",
    }),
    null,
  );
});

test("admin reset preserves role/status and bumps the version with a forced change", async () => {
  const { db, rows } = fakeDb([
    user({ role: "ORGANIZER", status: "PENDING" }),
  ]);
  const updated = await applyAdminPasswordReset(db, {
    targetId: "u1",
    expectedCredentialVersion: 0,
    tempPasswordHash: "hash-temp",
  });
  assert.ok(updated);
  assert.equal(updated.credentialVersion, 1);
  assert.equal(rows.get("u1")?.role, "ORGANIZER");
  assert.equal(rows.get("u1")?.status, "PENDING");
  assert.equal(rows.get("u1")?.mustChangePassword, true);
  assert.equal(rows.get("u1")?.password, "hash-temp");
});

test("a stale admin review cannot overwrite a newer credential", async () => {
  const { db, rows } = fakeDb([
    user({ password: "hash-v1", credentialVersion: 1 }),
  ]);
  assert.equal(
    await applyAdminPasswordReset(db, {
      targetId: "u1",
      expectedCredentialVersion: 0,
      tempPasswordHash: "hash-stale-temp",
    }),
    null,
  );
  assert.equal(rows.get("u1")?.password, "hash-v1");
  assert.equal(rows.get("u1")?.credentialVersion, 1);
});

test("legacy upgrade only replaces the exact verified value", async () => {
  const { db, rows } = fakeDb([user({ password: "plaintext" })]);
  assert.equal(
    await applyLegacyPasswordUpgrade(db, {
      userId: "u1",
      verifiedStoredValue: "plaintext",
      newPasswordHash: "hash-new",
    }),
    true,
  );
  assert.equal(rows.get("u1")?.password, "hash-new");

  const { db: raced } = fakeDb([user({ password: "hash-reset" })]);
  assert.equal(
    await applyLegacyPasswordUpgrade(raced, {
      userId: "u1",
      verifiedStoredValue: "plaintext",
      newPasswordHash: "hash-new",
    }),
    false,
  );
});
