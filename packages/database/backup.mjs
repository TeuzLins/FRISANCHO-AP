import { payloadHash } from './index.mjs';
import { inventoryDatabase, quoteIdentifier } from './inventory.mjs';
const tables = ['User', 'ReferenceDataset', 'Patient', 'Assessment', 'AuditEvent', 'IdempotencyRecord', 'Session'];
export async function backupDatabase(client, url) {
  const inventory = await inventoryDatabase(client, url), schema = quoteIdentifier(inventory.schema);
  const rows = await client.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY'); const rows = {};
    for (const name of tables.filter(name => inventory.tables.some(t => t.table_schema === inventory.schema && t.table_name === name))) {
      const result = await tx.$queryRawUnsafe(`SELECT row_to_json(t) AS data FROM ${schema}.${quoteIdentifier(name)} t ORDER BY id`);
      rows[name] = result.map(row => row.data);
    }
    return rows;
  }, { isolationLevel: 'RepeatableRead', timeout: 60000 });
  const data = { format: 'frisancho-private-backup-v1', inventory, rows };
  return { ...data, fingerprint: payloadHash(data) };
}
export async function restoreBackupRows(client, backup, schema) {
  const { fingerprint, ...data } = backup;
  if (backup.format !== 'frisancho-private-backup-v1' || payloadHash(data) !== fingerprint) throw new Error('Backup inválido.');
  await client.$transaction(async tx => {
    for (const name of tables.filter(name => backup.rows[name])) {
      const table = quoteIdentifier(schema) + '.' + quoteIdentifier(name);
      for (const row of backup.rows[name]) await tx.$executeRawUnsafe(`INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table}, $1::jsonb)`, JSON.stringify(row));
      const rows = await tx.$queryRawUnsafe(`SELECT row_to_json(t) AS data FROM ${table} t ORDER BY id`);
      if (payloadHash(rows.map(row => row.data)) !== payloadHash(backup.rows[name])) throw new Error('Conteúdo restaurado não corresponde ao backup.');
    }
  }, { isolationLevel: 'Serializable', timeout: 120000 });
}
