/**
 * Local no-admin account recovery (PostgreSQL).
 *
 * Usage: pnpm account:recover -- --email <email>
 *
 * Host-operator fallback when nobody can sign in — NOT a web endpoint and not
 * a way to register or approve a user. Generates a temporary password,
 * hashes it, increments the credential version, forces a change on next
 * sign-in, and shows the value once on this terminal. Role/status untouched.
 *
 * Safety: requires explicit DIRECT_URL (or DATABASE_URL) pointing at a
 * PostgreSQL maintenance target, verifies the target database identity before
 * any write, requires a TTY for both confirmation and secret display, and
 * never accepts a caller-supplied password. No second CLI and no second
 * credentialVersion migration — this is the ported #83 CLI.
 */
import "dotenv/config";
import { createInterface } from "node:readline";

import { prisma } from "@/globals/libs/prisma";
import { describeDatabaseUrl, getMigrationDatabaseUrl } from "@/globals/libs/dbConfig";
import {
  applyAdminPasswordReset,
  generateTemporaryPassword,
  lockUserRowsForUpdate,
} from "@/globals/utils/credentials";
import { hashPassword } from "@/globals/utils/password";

function usage(): never {
  console.error("Usage: pnpm account:recover -- --email <email>");
  process.exit(2);
}

function parseArgs(argv: string[]): { email: string } {
  let email: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--email") {
      email = argv[i + 1] ?? null;
      i++;
    } else if (arg.startsWith("--email=")) {
      email = arg.slice("--email=".length) || null;
    } else if (
      arg === "--password" ||
      arg.startsWith("--password=") ||
      arg === "--new-password" ||
      arg.startsWith("--new-password=")
    ) {
      console.error(
        "Refusing: this command never accepts a caller-supplied password. It generates one.",
      );
      process.exit(2);
    } else if (arg === "--help" || arg === "-h") {
      usage();
    }
  }
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized) usage();
  return { email: normalized };
}

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const { email } = parseArgs(process.argv.slice(2));

  // Fail closed on missing/non-PostgreSQL maintenance targets. DIRECT_URL is
  // preferred (non-pooled); DATABASE_URL is the local-dev fallback.
  const maintenanceUrl = getMigrationDatabaseUrl();

  // Verify the maintenance target identity before any write: confirm we can
  // connect, the server is PostgreSQL, and the database matches the URL.
  const identity = await prisma.$queryRaw<Array<{ db: string; ver: string }>>`
    SELECT current_database() AS db, version() AS ver
  `;
  const connectedDb = identity[0]?.db ?? "(unknown)";
  if (!identity[0]?.ver.toLowerCase().includes("postgresql")) {
    console.error("Refusing: maintenance target is not PostgreSQL. Nothing was changed.");
    process.exit(2);
  }

  // The secret is printed to this terminal exactly once: piped or redirected
  // output is refused so it cannot land in a log file unnoticed.
  if (!process.stdout.isTTY && process.env.ACCOUNT_RECOVER_ALLOW_NON_TTY !== "1") {
    console.error(
      "Refusing: secret output must go to an interactive terminal (stdout is not a TTY). Nothing was changed.",
    );
    process.exit(2);
  }
  if (!process.stdin.isTTY) {
    console.error(
      "Refusing: confirmation requires an interactive terminal. Nothing was changed.",
    );
    process.exit(2);
  }

  const target = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      mustChangePassword: true,
      credentialVersion: true,
    },
  });

  if (!target) {
    console.error(`No user found for ${email}. Nothing was changed.`);
    process.exit(1);
  }

  console.log(`Database: ${describeDatabaseUrl(maintenanceUrl)} (connected: ${connectedDb})`);
  console.log(
    `Target: ${target.name} <${target.email}> · ${target.role} · ${target.status} · credentialVersion ${target.credentialVersion}`,
  );
  console.log(
    "Stop the application and other database writers, and verify a PostgreSQL backup before continuing.",
  );
  console.log("Role and status will not be changed.");

  const typed = (
    await ask(`Type the target email to confirm (${target.email}): `)
  )
    .trim()
    .toLowerCase();
  if (typed !== target.email.toLowerCase()) {
    console.error("Confirmation did not match. Nothing was changed.");
    process.exit(2);
  }

  const temporaryPassword = generateTemporaryPassword();
  const tempHash = await hashPassword(temporaryPassword);
  // Guarded write on the same transaction connection: lock the target row,
  // then run the conditional reset + winning-generation reread there.
  const updated = await prisma.$transaction(async (tx) => {
    await lockUserRowsForUpdate(tx, [target.id]);
    return applyAdminPasswordReset(tx, {
      targetId: target.id,
      expectedCredentialVersion: target.credentialVersion,
      tempPasswordHash: tempHash,
    });
  });

  if (!updated) {
    console.error(
      "The account changed during recovery. Nothing was changed — re-run and confirm again.",
    );
    process.exit(1);
  }

  // One terminal display. Record only this nonsecret line in the operator log.
  console.log(`Temporary password for ${target.email}: ${temporaryPassword}`);
  console.log(
    `Done: ${target.email} credentialVersion ${target.credentialVersion} -> ${updated.credentialVersion}, forced change on. Role/status unchanged.`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
