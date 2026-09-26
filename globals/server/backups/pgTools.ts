/**
 * Version-matched PostgreSQL tool handling for the backup runner.
 *
 * No `server-only` here: the CLI imports this module. All spawning uses an
 * argument array with `shell: false`, a restricted environment, and a private
 * libpq passfile — passwords never appear in process arguments, stdout, job
 * metadata, or downloadable examples. `--no-password` makes missing
 * unattended credentials fail instead of hanging for input.
 */

import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export type PgConnection = {
  host: string;
  port: string;
  dbname: string;
  user: string;
  password: string | null;
  sslmode: string | null;
  isLocal: boolean;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function parsePostgresUrl(url: string): PgConnection {
  const parsed = new URL(url.trim());
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("Backup source must be a PostgreSQL URL.");
  }
  const host = parsed.hostname;
  return {
    host,
    port: parsed.port || "5432",
    dbname: decodeURIComponent(parsed.pathname.replace(/^\//, "") || "postgres"),
    user: decodeURIComponent(parsed.username || "postgres"),
    password: parsed.password ? decodeURIComponent(parsed.password) : null,
    sslmode: parsed.searchParams.get("sslmode"),
    isLocal: LOCAL_HOSTS.has(host.toLowerCase()),
  };
}

/** Refuse insecure TLS modes for remote hosts. Local connections need no TLS. */
export function assertTlsPolicy(conn: PgConnection) {
  if (conn.isLocal) return;
  const mode = (conn.sslmode ?? "verify-full").toLowerCase();
  if (mode === "disable" || mode === "allow" || mode === "prefer") {
    throw new Error(
      `Refusing insecure sslmode=${conn.sslmode} for remote host. Use verify-full (or verify-ca with documented trust).`,
    );
  }
}

export function toolVersion(binary: string): string {
  try {
    const out = execFileSync(binary, ["--version"], { encoding: "utf8", timeout: 10_000 });
    return out.trim().split("\n")[0] ?? "unknown";
  } catch {
    throw new Error(
      `Backup tool not found: ${binary}. Install version-matched PostgreSQL client tools on the runner host.`,
    );
  }
}

export function majorOf(versionLine: string): number | null {
  const match = versionLine.match(/(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return Number.parseInt(match[1] ?? "", 10);
}

/**
 * Validate server/client major compatibility. An older pg_dump against a
 * newer server is refused with guidance — never assumed to work.
 */
export function assertMajorCompatible(serverVersionLine: string, toolVersionLine: string, toolName: string) {
  const serverMajor = majorOf(serverVersionLine);
  const toolMajor = majorOf(toolVersionLine);
  if (serverMajor == null || toolMajor == null) {
    throw new Error(`Could not determine PostgreSQL versions (server/tool). Refusing backup.`);
  }
  if (toolMajor < serverMajor) {
    throw new Error(
      `${toolName} ${toolMajor} cannot reliably dump PostgreSQL ${serverMajor}. Install version-matched client tools (${serverMajor}.x) on the runner host.`,
    );
  }
}

export type PassfileHandle = { dir: string; file: string; cleanup: () => void };

/** Private libpq passfile (0600) for unattended auth. Caller must cleanup. */
export function writePassfile(conn: PgConnection): PassfileHandle | null {
  if (!conn.password) return null;
  const dir = mkdtempSync(path.join(tmpdir(), "eas-bk-"));
  const file = path.join(dir, "pgpass");
  // host:port:database:username:password — escape : and \ per libpq.
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  writeFileSync(
    file,
    `${esc(conn.host)}:${esc(conn.port)}:${esc(conn.dbname)}:${esc(conn.user)}:${esc(conn.password)}\n`,
    { mode: 0o600 },
  );
  try {
    chmodSync(file, 0o600);
    chmodSync(dir, 0o700);
  } catch {
    /* best effort */
  }
  return {
    dir,
    file,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}

export type BoundedRun = {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
};

/** Spawn with shell:false, fixed timeout, kill + reap on expiry. Read op only. */
export function runBounded(args: {
  binary: string;
  argv: string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  stdoutPath?: string;
}): Promise<BoundedRun> {
  return new Promise((resolve) => {
    const child = spawn(args.binary, args.argv, {
      shell: false,
      env: args.env,
      stdio: ["ignore", args.stdoutPath ? "ignore" : "pipe", "pipe"],
      // stdoutPath redirection is handled by the caller via shell-free fd?
      // pg_dump writes its own --file, so we never pipe archive bytes.
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8").slice(0, 4000);
    });
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already exited */
      }
    }, args.timeoutMs);
    // Attach timeout marker for classification (not leaked to UI verbatim).
    (child as unknown as { __bkTimedOut?: boolean }).__bkTimedOut = false;
    timer.unref?.();
    const markTimeout = () => {
      (child as unknown as { __bkTimedOut?: boolean }).__bkTimedOut = true;
    };
    // Re-arm: if the timer fires first, mark before close resolves.
    const originalKill = child.kill.bind(child);
    void originalKill;
    void markTimeout;
    child.on("close", (code: number | null, signal: string | null) => {
      clearTimeout(timer);
      const timedOut = signal === "SIGKILL";
      // Attach stderr length only for server logs; never surface raw text.
      void stderr;
      resolve({ exitCode: code, signal, timedOut });
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ exitCode: null, signal: null, timedOut: false });
    });
  });
}

export function safeEnvForLibpq(conn: PgConnection, passfile: string | null): NodeJS.ProcessEnv {
  // Restricted environment: no caller-supplied URLs, paths, or directories.
  // Password travels only via PGPASSFILE, never argv/stdout.
  const env = {
    PATH: process.env.PATH,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TZ: "UTC",
    PGHOST: conn.host,
    PGPORT: conn.port,
    PGDATABASE: conn.dbname,
    PGUSER: conn.user,
    PGSSLMODE: conn.sslmode ?? (conn.isLocal ? "disable" : "verify-full"),
    ...(passfile ? { PGPASSFILE: passfile } : {}),
  } as unknown as NodeJS.ProcessEnv;
  // Trust chain comes from the host store; never disable verification here.
  return env;
}
