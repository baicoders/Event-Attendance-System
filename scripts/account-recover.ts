/**
 * Local no-admin account recovery.
 *
 * Usage: pnpm account:recover -- --email <email>
 *
 * Host-operator fallback when nobody can sign in — NOT a web endpoint and not
 * a way to register or approve a user. Generates a temporary password,
 * hashes it, increments the credential version, forces a change on next
 * sign-in, and shows the value once on this terminal. Role/status untouched.
 *
 * Safety: requires an explicit DATABASE_URL, refuses a missing database file
 * (never silently creates an empty one), requires a TTY for both confirmation
 * and secret display, and never accepts a caller-supplied password.
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { prisma } from "@/globals/libs/prisma";
import {
  applyAdminPasswordReset,
  generateTemporaryPassword,
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

function resolveDatabaseFile(databaseUrl: string): string {
  // Only file: URLs are supported by this deployment. Anything else is
  // refused rather than guessed at.
  const match = /^file:(.+)$/.exec(databaseUrl.trim());
  if (!match) {
    console.error("Refusing: DATABASE_URL must be a file: URL.");
    process.exit(2);
  }
  const raw = match[1];
  return path.isAbsolute(raw)
    ? raw
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", raw);
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

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Refusing: DATABASE_URL is not set. Nothing was changed.");
    process.exit(2);
  }
  const dbFile = resolveDatabaseFile(databaseUrl);
  if (!existsSync(dbFile)) {
    console.error(
      `Refusing: database file not found at ${dbFile}. Nothing was changed.`,
    );
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

  console.log(`Database: ${dbFile}`);
  console.log(
    `Target: ${target.name} <${target.email}> · ${target.role} · ${target.status} · credentialVersion ${target.credentialVersion}`,
  );
  console.log(
    "Stop the application and other database writers, and back up the database file before continuing.",
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
  const updated = await applyAdminPasswordReset(prisma, {
    targetId: target.id,
    expectedCredentialVersion: target.credentialVersion,
    tempPasswordHash: await hashPassword(temporaryPassword),
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
