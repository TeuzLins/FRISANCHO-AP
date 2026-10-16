import { createHash } from 'node:crypto';
import { payloadHash } from './index.mjs';
export function quoteIdentifier(name) { if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name)) throw new Error('Nome de schema não suportado.'); return '"' + name + '"'; }
export async function inventoryDatabase(client, connectionURL) {
  const url = new URL(connectionURL), schema = url.searchParams.get('schema') || 'public'; quoteIdentifier(schema);
  return client.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${quoteIdentifier(schema)}`);
    const version = await tx.$queryRaw`SELECT current_setting('server_version') AS version, has_database_privilege(current_database(), 'CREATE') AS "canCreateSchema"`;
    const schemas = await tx.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name <> 'information_schema' ORDER BY schema_name`;
    const tables = await tx.$queryRaw`SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT LIKE 'pg_%' AND table_schema <> 'information_schema' AND table_type = 'BASE TABLE' ORDER BY table_schema, table_name`;
    const columns = await tx.$queryRaw`SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = ${schema} ORDER BY table_name, ordinal_position`;
    const constraints = await tx.$queryRaw`SELECT tc.table_name, tc.constraint_name, tc.constraint_type FROM information_schema.table_constraints tc WHERE tc.table_schema = ${schema} ORDER BY tc.table_name, tc.constraint_name`;
    const definitions = await tx.$queryRaw`SELECT cl.relname AS table_name, c.conname AS name, c.contype AS type, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class cl ON c.conrelid = cl.oid JOIN pg_namespace n ON cl.relnamespace = n.oid WHERE n.nspname = ${schema} AND c.contype IN ('p','u','f','c') ORDER BY cl.relname, c.conname`;
    const indexes = await tx.$queryRaw`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = ${schema} ORDER BY tablename, indexname`;
    const permissions = await tx.$queryRaw`SELECT has_schema_privilege(${schema}, 'USAGE') AS usage, has_schema_privilege(${schema}, 'CREATE') AS create WHERE EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = ${schema})`;
    let migrations = [];
    if (tables.some(t => t.table_schema === schema && t.table_name === '_prisma_migrations')) migrations = await tx.$queryRawUnsafe(`SELECT migration_name, checksum, finished_at, rolled_back_at FROM ${quoteIdentifier(schema)}."_prisma_migrations" ORDER BY started_at`);
    const identity = createHash('sha256').update(url.hostname + ':' + (url.port || '5432') + url.pathname + ':' + schema).digest('hex');
    return { format: 'frisancho-inventory-v1', identity, schema, version, schemas, tables, columns, constraints, definitions, indexes, permissions, migrations };
  }, { isolationLevel: 'RepeatableRead', timeout: 20000 });
}
export function structureSignature(inventory) {
  return payloadHash({ tables: inventory.tables.filter(t => t.table_schema === inventory.schema && t.table_name !== '_prisma_migrations').map(t => t.table_name), columns: inventory.columns.filter(c => c.table_name !== '_prisma_migrations').map(({ table_schema: _schema, ...column }) => column), definitions: inventory.definitions.filter(c => c.table_name !== '_prisma_migrations'), indexes: inventory.indexes.filter(i => i.tablename !== '_prisma_migrations').map(i => ({ ...i, indexdef: i.indexdef.replace(' ON ' + inventory.schema + '.', ' ON __schema__.').replace(' ON "' + inventory.schema + '".', ' ON __schema__.') })) });
}
export function deploymentPreflight(inventory, knownMigrations, local, signatures) {
  const tables = inventory.tables.filter(t => t.table_schema === inventory.schema);
  if (!tables.length) { if (!local && inventory.schema !== 'frisancho_ap') throw new Error('Selecione o schema exclusivo frisancho_ap para a primeira instalação remota.'); return; }
  if (!inventory.migrations.length) throw new Error('Schema existente sem histórico compatível. Baseline exige comprovação prévia; nenhuma migration foi aplicada.');
  for (const migration of inventory.migrations) {
    if (migration.rolled_back_at) continue;
    if (!migration.finished_at || knownMigrations[migration.migration_name] !== migration.checksum) throw new Error('Histórico de migrations desconhecido, alterado ou incompleto. Operação bloqueada.');
  }
  if (!['User', 'Session', 'Patient', 'Assessment', 'ReferenceDataset', 'AuditEvent'].every(name => tables.some(t => t.table_name === name))) throw new Error('Estrutura do FRISANCHO AP incompleta. Operação bloqueada.');
  if (signatures) {
    const last = inventory.migrations.filter(m => m.finished_at && !m.rolled_back_at).map(m => m.migration_name).sort().at(-1);
    if (signatures[last] !== structureSignature(inventory)) throw new Error('Estrutura física diverge das migrations reconhecidas. Operação bloqueada; confira o inventário antes de preparar baseline.');
  }
}
