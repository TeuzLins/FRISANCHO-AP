import { PrismaClient } from '@prisma/client';
import { prepareDatabase, databaseErrorCategory } from '@frisancho/database';
const connection = prepareDatabase();
export const db = new PrismaClient({ datasourceUrl: connection.url, log: [], transactionOptions: { maxWait: 5000, timeout: 10000 } });
export async function disconnectDatabase() { try { await db.$disconnect(); } finally { connection.cleanup(); } }
let readiness: Promise<boolean> | null = null;
export function databaseReady(): Promise<boolean> {
  if (!readiness) readiness = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        db.$transaction(async tx => { await tx.$executeRaw`SET LOCAL statement_timeout = '4000ms'`; await tx.$queryRaw`SELECT 1`; }, { maxWait: 1000, timeout: 4500 }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Database timeout')), 5000); }),
      ]); return true;
    } catch (error) { console.error('DATABASE_READINESS', databaseErrorCategory(error)); return false; }
    finally { if (timer) clearTimeout(timer); }
  })().finally(() => { readiness = null; });
  return readiness;
}
