/*
  Warnings:

  - You are about to drop the column `contactNumber` on the `Student` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Student" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "shsStrand" TEXT,
    "collegeProgram" TEXT,
    "section" TEXT NOT NULL,
    "yearLevel" TEXT NOT NULL,
    "schoolLevel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "department" TEXT,
    "departmentSlug" TEXT,
    "house" TEXT,
    "houseSlug" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Student" ("collegeProgram", "createdAt", "department", "departmentSlug", "firstName", "house", "houseSlug", "id", "lastName", "middleName", "schoolLevel", "section", "shsStrand", "status", "updatedAt", "yearLevel") SELECT "collegeProgram", "createdAt", "department", "departmentSlug", "firstName", "house", "houseSlug", "id", "lastName", "middleName", "schoolLevel", "section", "shsStrand", "status", "updatedAt", "yearLevel" FROM "Student";
DROP TABLE "Student";
ALTER TABLE "new_Student" RENAME TO "Student";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
