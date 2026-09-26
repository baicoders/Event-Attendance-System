import assert from "node:assert/strict";
import test from "node:test";

import { changePasswordSchema } from "./changePasswordSchema";

test("server schema rejects a replacement equal to the current password", () => {
  const parsed = changePasswordSchema.safeParse({
    currentPassword: "TempPass123",
    newPassword: "TempPass123",
  });
  assert.equal(parsed.success, false);
});

test("server schema accepts a distinct replacement and keeps the minimum", () => {
  assert.equal(
    changePasswordSchema.safeParse({
      currentPassword: "TempPass123",
      newPassword: " brand-new-pass ",
    }).success,
    true,
  );
  assert.equal(
    changePasswordSchema.safeParse({
      currentPassword: "TempPass123",
      newPassword: "short",
    }).success,
    false,
  );
  assert.equal(
    changePasswordSchema.safeParse({ currentPassword: "", newPassword: "brand-new-pass" })
      .success,
    false,
  );
});
