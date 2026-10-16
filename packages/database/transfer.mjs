import { canonicalJSON, payloadHash } from './index.mjs';
const models = ['user', 'referenceDataset', 'patient', 'assessment', 'auditEvent', 'idempotencyRecord'];
export class ImportConflict extends Error {
  constructor(conflicts) { super('Importação interrompida por conflitos; nenhum dado foi gravado.'); this.conflicts = conflicts; }
}
export async function sourceSnapshot(client) {
  return client.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const rows = {};
    for (const model of models) {
      rows[model] = await tx[model].findMany({ orderBy: { id: 'asc' }, take: 100001 });
      if (rows[model].length > 100000) throw new Error('Transferência excede o limite de 100 mil registros por entidade.');
    }
    return { format: 'frisancho-transfer-v1', rows, fingerprint: payloadHash(rows) };
  }, { isolationLevel: 'RepeatableRead', timeout: 60000 });
}
export async function importSnapshot(client, snapshot, { dryRun = true } = {}) {
  if (snapshot.format !== 'frisancho-transfer-v1' || payloadHash(snapshot.rows) !== snapshot.fingerprint) throw new Error('Snapshot inválido.');
  return client.$transaction(async tx => {
    if (dryRun) await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const conflicts = [], pending = {}, counts = {};
    for (const model of models) {
      const existing = await tx[model].findMany(); const byId = new Map(existing.map(row => [row.id, row]));
      const alternate = row => model === 'user' ? row.email.trim().toLowerCase() : model === 'patient' ? row.userId + ':' + row.identifier : model === 'referenceDataset' ? row.key + ':' + row.version : model === 'idempotencyRecord' ? row.userId + ':' + row.operation + ':' + row.key : null;
      const byAlternate = new Map(existing.map(row => [alternate(row), row])); const sourceAlternates = new Set();
      pending[model] = []; counts[model] = { source: snapshot.rows[model].length, identical: 0, create: 0 };
      for (const row of snapshot.rows[model]) {
        const key = alternate(row); const old = byId.get(row.id), collision = key !== null ? byAlternate.get(key) : undefined;
        if (model === 'user' && (row.email !== row.email.trim().toLowerCase() || !/^\$argon2id\$/.test(row.passwordHash))) { conflicts.push({ model, id: row.id, reason: 'INVALID_USER_CONTRACT' }); continue; }
        if (key !== null && sourceAlternates.has(key)) { conflicts.push({ model, id: row.id, reason: 'SOURCE_DUPLICATE' }); continue; }
        sourceAlternates.add(key);
        if (old) {
          if (canonicalJSON(old) === canonicalJSON(row)) counts[model].identical++;
          else conflicts.push({ model, id: row.id, reason: 'ID_DIFFERENT_CONTENT' });
        } else if (collision) conflicts.push({ model, id: row.id, reason: 'UNIQUE_KEY_COLLISION' });
        else { pending[model].push(row); counts[model].create++; }
      }
    }
    if (conflicts.length) throw new ImportConflict(conflicts);
    if (!dryRun) {
      for (const model of models) for (const row of pending[model]) await tx[model].create({ data: row });
      for (const model of models) {
        const current = new Map((await tx[model].findMany()).map(row => [row.id, row]));
        for (const row of snapshot.rows[model]) if (canonicalJSON(current.get(row.id)) !== canonicalJSON(row)) throw new Error('Verificação de integridade da transferência falhou. Transação revertida.');
      }
    }
    return { dryRun, fingerprint: snapshot.fingerprint, counts, sessionsTransferred: 0 };
  }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 120000 });
}
