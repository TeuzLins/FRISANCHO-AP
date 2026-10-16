import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (!existsSync('.env')) {
  const password = randomBytes(24).toString('hex');
  writeFileSync('.env', `DATABASE_URL=postgresql://frisancho:${password}@127.0.0.1:54329/frisancho?schema=public\nPORT=3000\nNODE_ENV=development\nAPP_ORIGIN=http://localhost:3000\nTRUST_PROXY_HOPS=0\nSESSION_DAYS=7\n`);
  console.log('.env local criado com senha aleatória; nenhum segredo foi exibido.');
} else console.log('.env existente preservado.');
