import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
process.loadEnvFile('.env');
const url = new URL(process.env.DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || process.env.NODE_ENV === 'production') throw new Error('Os testes exigem um PostgreSQL local de desenvolvimento.');
const schema = `frisancho_test_${randomBytes(8).toString('hex')}`;
if (!/^frisancho_test_[a-f0-9]{16}$/.test(schema)) throw new Error('Schema de testes inválido.');
const admin = new PrismaClient();
await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
url.searchParams.set('schema', schema);
const env = { ...process.env, DATABASE_URL: url.toString(), TEST_DATABASE_URL: url.toString() };
let status = 1;
try {
  const migrate = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], { env, stdio: 'inherit' });
  if (migrate.status !== 0) throw new Error('Migração do schema de testes falhou.');
  status = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run'], { env, stdio: 'inherit' }).status ?? 1;
} finally {
  await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.$disconnect();
}
process.exitCode = status;
