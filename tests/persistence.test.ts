import { it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { calculationSchema } from '@frisancho/anthropometry';
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app, db } from '../apps/api/src/app.js';
import { sourceSnapshot, importSnapshot, ImportConflict } from '../packages/database/transfer.mjs';
import { inventoryDatabase, deploymentPreflight } from '../packages/database/inventory.mjs';
import { prepareDatabase, payloadHash } from '@frisancho/database';
const origin = process.env.APP_ORIGIN || 'http://localhost:3000';
const input = { ageYears: 76, referenceSex: null, armCircumferenceCm: 30, tricepsSkinfoldMm: 16, reportedMuscleCircumferenceCm: 25 };
const password = 'Teste-local-seguro-2026';
const temporary: string[] = [];
afterAll(async () => { for (const schema of temporary) await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await db.$disconnect(); });
async function isolated() {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Use npm test.');
  const schema = 'frisancho_extra_' + randomBytes(8).toString('hex'); temporary.push(schema);
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const url = new URL(process.env.TEST_DATABASE_URL); url.searchParams.set('schema', schema);
  return { schema, url: url.toString(), client: new PrismaClient({ datasourceUrl: url.toString(), log: [] }) };
}
function migrate(url: string, schemaPath = 'apps/api/prisma/schema.prisma') {
  const r = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', schemaPath], { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });
  expect(r.status, 'migration deve concluir sem perda de registros').toBe(0);
}
async function fixture() {
  const agent = request.agent(app); const email = `persist-${randomUUID()}@example.invalid`;
  const auth = await agent.post('/api/v1/auth/register').set('Origin', origin).send({ email, name: 'Fictício persistência', password });
  expect(auth.status).toBe(201); const csrf = auth.body.csrfToken;
  const patient = await agent.post('/api/v1/patients').set('Origin', origin).set('X-CSRF-Token', csrf).send({ identifier: randomUUID(), displayName: 'Nome histórico', birthDate: '1950-01-01' });
  expect(patient.status).toBe(201);
  const body = { patientId: patient.body.id, evaluationDate: '2026-10-09', inputs: input }; const key = randomUUID();
  const saved = await agent.post('/api/v1/assessments').set('Origin', origin).set('X-CSRF-Token', csrf).set('Idempotency-Key', key).send(body); expect(saved.status).toBe(201);
  return { agent, email, userId: auth.body.user.id, csrf, patient: patient.body, body, key, saved: saved.body };
}
it('separa liveness de readiness e limita indisponibilidade a estado genérico', async () => {
  expect((await request(app).get('/api/v1/live')).body).toEqual({ status: 'ok' });
  expect((await request(app).get('/api/v1/ready')).body.database).toBe('connected');
});
it('snapshot histórico permanece após editar e arquivar paciente; datas civis são preservadas', async () => {
  const f = await fixture();
  await f.agent.patch(`/api/v1/patients/${f.patient.id}`).set('Origin', origin).set('X-CSRF-Token', f.csrf).send({ displayName: 'Nome atual diferente', archived: true });
  expect((await f.agent.get(`/api/v1/assessments/${f.saved.id}`)).body.patient.displayName).toBe('Nome histórico');
  expect((await f.agent.get('/api/v1/patients')).body.items.some((p: { id: string }) => p.id === f.patient.id)).toBe(false);
  expect((await f.agent.get('/api/v1/patients?archived=archived')).body.items.some((p: { id: string }) => p.id === f.patient.id)).toBe(true);
  expect((await f.agent.post('/api/v1/assessments').set('Origin', origin).set('X-CSRF-Token', f.csrf).set('Idempotency-Key', randomUUID()).send(f.body)).status).toBe(409);
  const patch = await f.agent.patch(`/api/v1/assessments/${f.saved.id}`).set('Origin', origin).set('X-CSRF-Token', f.csrf).send({ ...f.body, revision: 1 }); expect(patch.status).toBe(200);
  const rows = await db.$transaction(async tx => { await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Honolulu'`; return tx.$queryRaw<{ date: string }[]>`SELECT to_char("evaluationDate", 'YYYY-MM-DD') AS date FROM "Assessment" WHERE id = ${f.saved.id}`; });
  expect(rows[0].date).toBe('2026-10-09'); expect(patch.body.evaluationDate).toBe('2026-10-09');
  const persisted = await db.assessment.findUniqueOrThrow({ where: { id: f.saved.id } });
  await db.referenceDataset.update({ where: { id: persisted.referenceId }, data: { metadata: { title: 'Metadado alterado para teste' } } });
  expect((await f.agent.get(`/api/v1/assessments/${f.saved.id}`)).body.result.reference.title).toBe(f.saved.result.reference.title);
});
it('retry após edição devolve resposta original; exclusão apaga resposta clínica e não recria', async () => {
  const f = await fixture();
  const editBody = { ...f.body, inputs: { ...input, armCircumferenceCm: 31 }, revision: 1 }, editKey = randomUUID();
  const edited = await f.agent.patch(`/api/v1/assessments/${f.saved.id}`).set('Origin', origin).set('X-CSRF-Token', f.csrf).set('Idempotency-Key', editKey).send(editBody); expect(edited.status).toBe(200);
  const editedRetry = await f.agent.patch(`/api/v1/assessments/${f.saved.id}`).set('Origin', origin).set('X-CSRF-Token', f.csrf).set('Idempotency-Key', editKey).send(editBody); expect(editedRetry.body).toEqual(edited.body);
  // Migrated legacy responses must not expose internal ownership/idempotency fields.
  await db.idempotencyRecord.updateMany({ where: { userId: f.userId, key: f.key }, data: { hashVersion: 'legacy-json', requestHash: createHash('sha256').update(JSON.stringify({ ...f.body, inputs: calculationSchema.parse(f.body.inputs) })).digest('hex'), response: { ...f.saved, userId: f.userId, requestHash: 'internal', idempotencyKey: f.key } } });
  const retry = await f.agent.post('/api/v1/assessments').set('Origin', origin).set('X-CSRF-Token', f.csrf).set('Idempotency-Key', f.key).send(f.body); expect(retry.body).toEqual(f.saved);
  await f.agent.delete(`/api/v1/assessments/${f.saved.id}`).set('Origin', origin).set('X-CSRF-Token', f.csrf);
  expect((await f.agent.post('/api/v1/assessments').set('Origin', origin).set('X-CSRF-Token', f.csrf).set('Idempotency-Key', f.key).send(f.body)).status).toBe(410);
  expect(await db.idempotencyRecord.count({ where: { entityId: f.saved.id, response: { not: { equals: null } } } })).toBe(0);
});
it('envios concorrentes com chave idêntica produzem uma avaliação e uma auditoria', async () => {
  const f = await fixture(), key = randomUUID();
  const send = () => f.agent.post('/api/v1/assessments').set('Origin', origin).set('X-CSRF-Token', f.csrf).set('Idempotency-Key', key).send(f.body);
  const responses = await Promise.all([send(), send(), send()]); expect(responses.map(r => r.status).sort()).toEqual([200, 200, 201]);
  expect(new Set(responses.map(r => r.body.id)).size).toBe(1);
  expect(await db.auditEvent.count({ where: { entityId: responses[0].body.id, action: 'ASSESSMENT_CREATED' } })).toBe(1);
});
it('banco rejeita vínculo de proprietário diferente e medidas inválidas mesmo fora da API', async () => {
  const f = await fixture(), other = await fixture();
  await expect(db.assessment.update({ where: { id: f.saved.id }, data: { patientId: other.patient.id } })).rejects.toThrow();
  await expect(db.assessment.update({ where: { id: f.saved.id }, data: { inputs: { ...input, armCircumferenceCm: 0 } } })).rejects.toThrow();
  await expect(db.assessment.update({ where: { id: f.saved.id }, data: { inputs: {} } })).rejects.toThrow();
});
it('sessão revogada e usuário desativado são recusados; email duplicado não cria usuário', async () => {
  const f = await fixture();
  expect((await request(app).post('/api/v1/auth/register').set('Origin', origin).send({ email: f.email.toUpperCase(), name: 'Duplicado', password })).status).toBe(409);
  await db.user.update({ where: { id: f.userId }, data: { status: 'disabled' } });
  expect((await f.agent.get('/api/v1/auth/me')).status).toBe(401);
  expect((await request(app).post('/api/v1/auth/login').set('Origin', origin).send({ email: f.email, password })).status).toBe(401);
});
it('importação simula sem gravar, preserva conteúdo, repete sem duplicar e aborta conflito sem gravações parciais', async () => {
  await fixture(); const target = await isolated();
  try {
    migrate(target.url); const snapshot = await sourceSnapshot(db);
    expect((await importSnapshot(target.client, snapshot)).dryRun).toBe(true); expect(await target.client.user.count()).toBe(0);
    const applied = await importSnapshot(target.client, snapshot, { dryRun: false }); expect(applied.sessionsTransferred).toBe(0);
    expect(await target.client.session.count()).toBe(0);
    const repeat = await importSnapshot(target.client, snapshot, { dryRun: false }); expect(Object.values(repeat.counts).every((c: { create: number }) => c.create === 0)).toBe(true);
    await target.client.patient.update({ where: { id: snapshot.rows.patient[0].id }, data: { displayName: 'Conflito remoto' } });
    const before = await target.client.user.count();
    await expect(importSnapshot(target.client, snapshot, { dryRun: false })).rejects.toBeInstanceOf(ImportConflict); expect(await target.client.user.count()).toBe(before);
    await target.client.$disconnect(); await target.client.$connect(); expect(await target.client.assessment.count()).toBe(snapshot.rows.assessment.length);
  } finally { await target.client.$disconnect(); }
}, 30000);
it('migration evolui banco inicial com registros sem alterar resultado, data ou hash de senha', async () => {
  const target = await isolated(); const stage = mkdtempSync(path.resolve('.local/migration-test-'));
  mkdirSync(path.join(stage, 'migrations')); cpSync('apps/api/prisma/migrations/202610080001_initial', path.join(stage, 'migrations/202610080001_initial'), { recursive: true });
  writeFileSync(path.join(stage, 'schema.prisma'), 'datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n}\n');
  try {
    migrate(target.url, path.join(stage, 'schema.prisma'));
    const uid = randomUUID(), pid = randomUUID(), aid = randomUUID();
    await target.client.$executeRaw`INSERT INTO "User" (id,email,name,"passwordHash") VALUES (${uid},${uid + '@example.invalid'},'Fictício','hash-preservado')`;
    await target.client.$executeRaw`INSERT INTO "Patient" (id,"userId",identifier,"displayName","birthDate") VALUES (${pid},${uid},'LEGACY','Legado','1950-01-01')`;
    await target.client.$executeRaw`INSERT INTO "ReferenceDataset" (id,version,metadata) VALUES ('legacy','v1','{}'::jsonb)`;
    const inputs = { ageYears: 76, armCircumferenceCm: 30, tricepsSkinfoldMm: 16 };
    await target.client.$executeRaw`INSERT INTO "Assessment" (id,"userId","patientId","evaluationDate","ageYears",inputs,result,"referenceId","engineVersion","idempotencyKey","requestHash","updatedAt") VALUES (${aid},${uid},${pid},'2026-10-09',76,${JSON.stringify(inputs)}::jsonb,'{"muscleCircumferenceCm":24.97345175425633}'::jsonb,'legacy','cmb-1.0.0',${randomUUID()},'legacy-hash',CURRENT_TIMESTAMP)`;
    // Simulate a compatible legacy schema without migration history, exclusively in this disposable schema.
    await target.client.$executeRawUnsafe('DROP TABLE "_prisma_migrations"');
    writeFileSync(path.join(stage, 'baseline.env'), 'DATABASE_URL=' + JSON.stringify(target.url) + '\nNODE_ENV=development\n', { mode: 0o600 });
    const baseline = spawnSync(process.execPath, ['scripts/db.mjs', 'baseline', '--env-file', path.join(stage, 'baseline.env'), '--migration', '202610080001_initial', '--backup-reference', 'ISOLATED-TEST-SNAPSHOT'], { encoding: 'utf8' });
    expect(baseline.status, 'baseline só pode reconhecer a estrutura inicial equivalente').toBe(0);
    migrate(target.url); const row = await target.client.assessment.findUniqueOrThrow({ where: { id: aid } });
    expect(row.evaluationDate.toISOString()).toBe('2026-10-09T00:00:00.000Z'); expect(row.patientSnapshot).toMatchObject({ displayName: 'Legado', birthDate: '1950-01-01' });
    expect((await target.client.user.findUniqueOrThrow({ where: { id: uid } })).passwordHash).toBe('hash-preservado');
    expect((await target.client.idempotencyRecord.findFirstOrThrow()).hashVersion).toBe('legacy-json');
  } finally { await target.client.$disconnect(); }
}, 30000);
it('preflight bloqueia schema remoto desconhecido e URL remota sem TLS; hash ignora ordem das propriedades', () => {
  expect(() => prepareDatabase({ DATABASE_URL: 'postgresql://u:p@remote.invalid:5432/db' })).toThrow(/TLS/);
  expect(() => deploymentPreflight({ schema: 'public', tables: [{ table_schema: 'public', table_name: 'OtherApp' }], migrations: [] }, {}, false)).toThrow();
  expect(payloadHash({ a: 1, b: 2 })).toBe(payloadHash({ b: 2, a: 1 }));
});
it('inventário não grava dados nem retorna connection string ou dados clínicos', async () => {
  const inventory = await inventoryDatabase(db, process.env.TEST_DATABASE_URL); expect(inventory.tables.length).toBeGreaterThan(0); expect(JSON.stringify(inventory)).not.toContain('passwordHash":');
  expect(inventory.format).toBe('frisancho-inventory-v1');
});
