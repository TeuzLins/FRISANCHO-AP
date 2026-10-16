import { PrismaClient } from '@prisma/client';
import { prepareDatabase, canonicalJSON, databaseErrorCategory, restrictPrivateFile } from '@frisancho/database';
import { inventoryDatabase, deploymentPreflight, structureSignature } from '@frisancho/database/inventory';
import { sourceSnapshot, importSnapshot, ImportConflict } from '@frisancho/database/transfer';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, cpSync, mkdtempSync } from 'node:fs';
import { backupDatabase, restoreBackupRows } from '@frisancho/database/backup';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const args = process.argv.slice(2), command = args.shift();
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const clients = [], connections = [];
// parseEnv avoids process-global leakage and makes explicit env files authoritative.
import { parseEnv } from 'node:util';
function envFile(file) { return { ...process.env, ...(file ? parseEnv(readFileSync(file, 'utf8')) : {}) }; }
function connect(env) { const prepared = prepareDatabase(env); connections.push(prepared); const client = new PrismaClient({ datasourceUrl: prepared.url, log: [] }); clients.push(client); return { client, prepared, env }; }
function privateReport(file, value) { const output = path.resolve(file || '.local/database-report.json'); mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 }); writeFileSync(output, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); restrictPrivateFile(output); console.log('Relatório privado gravado no caminho solicitado.'); }
const migrationRoot = 'apps/api/prisma/migrations';
function migrations() { return Object.fromEntries(readdirSync(migrationRoot, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => [d.name, createHash('sha256').update(readFileSync(path.join(migrationRoot, d.name, 'migration.sql'))).digest('hex')])); }
async function reviewedInventory(target) {
  const inventory = await inventoryDatabase(target.client, target.prepared.url);
  if (!target.prepared.local) {
    const file = option('--inventory');
    if (!file || canonicalJSON(JSON.parse(readFileSync(file, 'utf8'))) !== canonicalJSON(JSON.parse(JSON.stringify(inventory)))) throw new Error('Execute db:inventory e forneça seu relatório atual com --inventory antes de alterar o banco remoto.');
  }
  return inventory;
}
async function preflight(target) {
  const inventory = await reviewedInventory(target), signatures = JSON.parse(readFileSync('apps/api/prisma/schema-signatures.json', 'utf8'));
  deploymentPreflight(inventory, migrations(), target.prepared.local, signatures); return inventory;
}
try {
  const env = envFile(option('--env-file') || (existsSync('.env') ? '.env' : undefined));
  if (command === 'generate') {
    const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'generate', '--schema', 'apps/api/prisma/schema.prisma'], { env, encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Geração do Prisma Client falhou. Verifique versão e processos que estejam usando o engine.');
    console.log('Prisma Client gerado.');
  } else if (command === 'import') {
    if (!option('--source-env') || !option('--target-env')) throw new Error('Informe --source-env e --target-env com arquivos privados.');
    const source = connect(envFile(option('--source-env'))), target = connect(envFile(option('--target-env')));
    const sourceURL = new URL(source.prepared.url), targetURL = new URL(target.prepared.url);
    if (sourceURL.host === targetURL.host && sourceURL.pathname === targetURL.pathname && sourceURL.searchParams.get('schema') === targetURL.searchParams.get('schema')) throw new Error('Origem e destino devem ser separados.');
    await preflight(target);
    const dryRun = !args.includes('--apply');
    if (!dryRun && !option('--backup-reference')) throw new Error('Registre o snapshot/backup existente com --backup-reference antes de aplicar a importação.');
    const snapshot = await sourceSnapshot(source.client);
    const report = await importSnapshot(target.client, snapshot, { dryRun });
    privateReport(option('--output') || '.local/import-report.json', { ...report, backupReference: option('--backup-reference') || null });
    console.log(dryRun ? 'Simulação concluída; nenhum registro gravado.' : 'Transferência concluída e conferida; sessões locais não transferidas.');
  } else {
    const target = connect(env);
    if (command === 'inventory') privateReport(option('--output') || '.local/database-inventory.json', await inventoryDatabase(target.client, target.prepared.url));
    else if (command === 'backup') privateReport(option('--output') || '.local/database-backup.json', await backupDatabase(target.client, target.prepared.url));
    else if (command === 'baseline') {
      const inventory = await reviewedInventory(target), migration = '202610080001_initial';
      const signatures = JSON.parse(readFileSync('apps/api/prisma/schema-signatures.json', 'utf8'));
      if (!option('--backup-reference') || option('--migration') !== migration || inventory.migrations.length || structureSignature(inventory) !== signatures[migration]) throw new Error('Baseline bloqueado: exige backup registrado, nenhuma migration existente e estrutura exatamente equivalente à migration inicial.');
      const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'resolve', '--applied', migration, '--schema', 'apps/api/prisma/schema.prisma'], { env: { ...env, DATABASE_URL: target.prepared.url }, encoding: 'utf8', timeout: 120000 });
      if (result.status !== 0) throw new Error('Baseline não concluído.'); console.log('Baseline inicial registrado após comprovação estrutural; tabelas clínicas preservadas.');
    }
    else if (command === 'restore') {
      const schema = new URL(target.prepared.url).searchParams.get('schema');
      if (!target.prepared.local || env.NODE_ENV === 'production' || !/^frisancho_restore_[a-f0-9]{16}$/.test(schema || '') || !option('--input')) throw new Error('Restauração exige destino local isolado frisancho_restore_<16 hex> e --input.');
      const inventory = await inventoryDatabase(target.client, target.prepared.url);
      if (inventory.tables.some(t => t.table_schema === schema)) throw new Error('Destino de restauração deve estar vazio.');
      const backup = JSON.parse(readFileSync(option('--input'), 'utf8')); const { fingerprint, ...data } = backup;
      if (createHash('sha256').update(canonicalJSON(data)).digest('hex') !== fingerprint || backup.format !== 'frisancho-private-backup-v1') throw new Error('Backup inválido.');
      const known = migrations(), applied = backup.inventory.migrations.filter(m => m.finished_at && !m.rolled_back_at);
      if (!applied.length || applied.some(m => known[m.migration_name] !== m.checksum)) throw new Error('Histórico do backup não corresponde às migrations versionadas.');
      mkdirSync('.local', { recursive: true }); const stage = mkdtempSync(path.resolve('.local/restore-stage-')); mkdirSync(path.join(stage, 'migrations'));
      for (const m of applied) cpSync(path.join(migrationRoot, m.migration_name), path.join(stage, 'migrations', m.migration_name), { recursive: true });
      writeFileSync(path.join(stage, 'schema.prisma'), 'datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n}\n');
      const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', path.join(stage, 'schema.prisma')], { env: { ...env, DATABASE_URL: target.prepared.url }, encoding: 'utf8', timeout: 120000 });
      if (result.status !== 0) throw new Error('Preparação do destino isolado falhou.');
      await restoreBackupRows(target.client, backup, schema); console.log('Backup restaurado e conteúdo conferido em schema local isolado.');
    }
    else if (command === 'check') { await target.client.$queryRaw`SELECT 1`; console.log('Banco conectado; configuração TLS válida quando exigida.'); }
    else if (command === 'cleanup') { const removed = await target.client.idempotencyRecord.deleteMany({ where: { expiresAt: { lte: new Date() } } }); console.log(`Registros de idempotência expirados removidos: ${removed.count}.`); }
    else if (['status', 'migrate:deploy', 'migrate:dev'].includes(command)) {
      if (command === 'migrate:dev' && (!target.prepared.local || env.NODE_ENV === 'production')) throw new Error('migrate dev exige banco local de desenvolvimento.');
      if (command === 'migrate:deploy') {
        const inventory = await preflight(target);
        if (!target.prepared.local && inventory.tables.some(t => t.table_schema === inventory.schema) && !option('--backup-reference')) throw new Error('Registre um snapshot/backup existente com --backup-reference antes de alterar o banco remoto.');
      }
      const cliArgs = command === 'status' ? ['migrate', 'status'] : ['migrate', command.split(':')[1]];
      if (command === 'migrate:dev') cliArgs.push('--name', option('--name') || 'schema_update');
      const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...cliArgs, '--schema', 'apps/api/prisma/schema.prisma'], { env: { ...env, DATABASE_URL: target.prepared.url }, encoding: 'utf8', timeout: 120000 });
      // Do not forward CLI output: datasource URLs and engine diagnostics can contain secrets.
      if (result.status !== 0) { console.error('DB_CLI', databaseErrorCategory({ message: result.stderr, code: /P\d{4}/.exec(result.stderr || '')?.[0] })); throw new Error('Comando Prisma não concluído. Confira histórico, permissões e certificados privadamente.'); }
      console.log(command === 'status' ? 'Migrations aplicadas e atualizadas.' : 'Migrations concluídas.');
    } else throw new Error('Comando de banco desconhecido.');
  }
} catch (error) {
  if (error instanceof ImportConflict) privateReport(option('--output') || '.local/import-conflicts.json', { conflicts: error.conflicts, applied: false });
  console.error('DB_OPERATION_FAILED', databaseErrorCategory(error));
  // Our own validation messages contain no URL or database error details.
  console.error('Operação não concluída. Confira os argumentos e o guia privado de diagnóstico; nenhuma mensagem interna do banco foi exibida.');
  process.exitCode = 1;
} finally { for (const client of clients) await client.$disconnect(); for (const connection of connections) connection.cleanup(); }
