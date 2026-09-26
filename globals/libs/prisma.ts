import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  RUNTIME_POOL_TUNING,
  getRuntimeDatabaseUrl,
  sslForUrl,
} from './dbConfig';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  // Fail fast: a misconfigured deployment must fail loudly instead of
  // silently running against the wrong database.
  const connectionString = getRuntimeDatabaseUrl();
  const ssl = sslForUrl(connectionString);

  const pool = new Pool({
    connectionString,
    max: RUNTIME_POOL_TUNING.max,
    connectionTimeoutMillis: RUNTIME_POOL_TUNING.connectionTimeoutMillis,
    idleTimeoutMillis: RUNTIME_POOL_TUNING.idleTimeoutMillis,
    ...(ssl ? { ssl } : {}),
  });
  pool.on('error', (error) => {
    // Pool-level errors (idle client failures, restarts) are logged, not
    // thrown: in-flight transactions surface their own errors.
    console.error('[prisma] idle pool error', error);
  });

  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    // Bulk roster imports (2,000+ upserts in one transaction) run far longer
    // than Prisma's default 5s timeout / 2s maxWait. Keep generous defaults
    // at the client level so a full-roster import, and any import that has
    // to queue behind one, completes instead of erroring.
    transactionOptions: {
      timeout: 120_000,
      maxWait: 30_000,
    },
    // log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}