import assert from "node:assert/strict";
import test from "node:test";
import {
  contentVersion,
  projectStudentContent,
  reviewFingerprint,
} from "./studentContentVersion";

const student = {
  id: "00000123456",
  firstName: "Juan",
  lastName: "Dela Cruz",
  middleName: null,
  schoolLevel: "COLLEGE",
  yearLevel: "YEAR_2",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  groups: [
    { id: "sec-a", slug: "bsit-2a", category: "SECTION" as const },
    { id: "house-azul", slug: "azul", category: "HOUSE" as const },
  ],
};

test("membership-only changes invalidate the version even when updatedAt is frozen", () => {
  const before = contentVersion(projectStudentContent(student));
  const after = contentVersion(
    projectStudentContent({
      ...student,
      groups: [
        { id: "sec-b", slug: "bsit-2b", category: "SECTION" as const },
        { id: "house-azul", slug: "azul", category: "HOUSE" as const },
      ],
    }),
  );
  assert.notEqual(before, after);
});

test("cosmetic renames do not change the edit version but do change the review fingerprint", () => {
  const before = contentVersion(projectStudentContent(student));
  // projectStudentContent intentionally excludes Group names, so a rename that
  // keeps id/slug/category identical leaves the version stable.
  const renamed = contentVersion(projectStudentContent({ ...student }));
  assert.equal(before, renamed);

  const fpBefore = reviewFingerprint({
    targetId: "sec-b",
    targetSlug: "bsit-2b",
    targetName: "BSIT 2B",
    targetCategory: "SECTION",
    beforeLabels: [{ id: student.id, slug: "bsit-2a", name: "BSIT 2A" }],
  });
  const fpAfter = reviewFingerprint({
    targetId: "sec-b",
    targetSlug: "bsit-2b",
    targetName: "BSIT 2B (renamed)",
    targetCategory: "SECTION",
    beforeLabels: [{ id: student.id, slug: "bsit-2a", name: "BSIT 2A" }],
  });
  assert.notEqual(fpBefore, fpAfter);
});
