import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app, db } from '../apps/api/src/app.js';
const origin = process.env.APP_ORIGIN || 'http://localhost:3000';
const input = { ageYears: 76, referenceSex: null, armCircumferenceCm: 30, tricepsSkinfoldMm: 16, reportedMuscleCircumferenceCm: 25 };
const a = request.agent(app), b = request.agent(app);
let csrfA = '', csrfB = '', patientId = '', assessmentId = '';
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Use npm test para criar um schema PostgreSQL isolado.');
  for (const [agent, name] of [[a, 'A'], [b, 'B']] as const) {
    const res = await agent.post('/api/v1/auth/register').set('Origin', origin).send({ name: `Usuário ${name}`, email: `${name}-${randomUUID()}@example.invalid`, password: 'Teste-local-seguro-2026' });
    expect(res.status).toBe(201); expect(res.headers['set-cookie'][0]).toContain('HttpOnly');
    if (name === 'A') csrfA = res.body.csrfToken; else csrfB = res.body.csrfToken;
  }
});
afterAll(async () => { await db.$disconnect(); });
describe('API real com Prisma e PostgreSQL', () => {
  it('verifica a conexão com o banco', async () => { const r = await request(app).get('/api/v1/health'); expect(r.status).toBe(200); expect(r.body.database).toBe('connected'); });
  it('calcula sem login e sem persistência', async () => { const before = await db.assessment.count(); const r = await request(app).post('/api/v1/calculations/cmb').send(input); expect(r.status).toBe(200); expect(r.body.displayValue).toBe('24,97'); expect(r.body.classificationUnavailableReasons).toHaveLength(3); expect(await db.assessment.count()).toBe(before); });
  it('valida de novo no servidor e rejeita campos não autorizados', async () => { expect((await request(app).post('/api/v1/calculations/cmb').send({ ...input, armCircumferenceCm: 0 })).status).toBe(422); expect((await request(app).post('/api/v1/calculations/cmb').send({ ...input, userId: 'intruso' })).status).toBe(422); });
  it('retorna erros JSON para API desconhecida e HTML para rota SPA', async () => { const r = await request(app).get('/api/v1/nao-existe'); expect(r.status).toBe(404); expect(r.type).toBe('application/json'); expect((await request(app).get('/historico')).type).toBe('text/html'); });
  it('exige autenticação, origem e CSRF', async () => { expect((await request(app).get('/api/v1/patients')).status).toBe(401); expect((await a.post('/api/v1/patients').set('Origin', origin).send({ identifier: 'a', displayName: 'Teste' })).status).toBe(403); expect((await a.post('/api/v1/patients').set('Origin', 'https://evil.invalid').set('X-CSRF-Token', csrfA).send({ identifier: 'a', displayName: 'Teste' })).status).toBe(403); });
  it('cadastra paciente pertencente a A e preserva campos não alterados no PATCH', async () => { const r = await a.post('/api/v1/patients').set('Origin', origin).set('X-CSRF-Token', csrfA).send({ identifier: 'FICTICIO-1', displayName: 'Caso fictício', birthDate: '1950-10-09' }); expect(r.status).toBe(201); patientId = r.body.id; const patch = await a.patch(`/api/v1/patients/${patientId}`).set('Origin', origin).set('X-CSRF-Token', csrfA).send({ displayName: 'Caso fictício atualizado' }); expect(patch.body.birthDate).toBe('1950-10-09'); });
  it('rejeita avaliação anterior ao nascimento como erro por campo', async () => { const r = await a.post('/api/v1/assessments').set('Origin', origin).set('X-CSRF-Token', csrfA).set('Idempotency-Key', randomUUID()).send({ patientId, evaluationDate: '1949-01-01', inputs: input }); expect(r.status).toBe(422); expect(r.body.error.fields.evaluationDate).toBeDefined(); });
  it('B não consegue ler, editar ou excluir paciente de A', async () => { expect((await b.get(`/api/v1/patients/${patientId}`)).status).toBe(404); expect((await b.patch(`/api/v1/patients/${patientId}`).set('Origin', origin).set('X-CSRF-Token', csrfB).send({ displayName: 'Intrusão' })).status).toBe(404); expect((await b.delete(`/api/v1/patients/${patientId}`).set('Origin', origin).set('X-CSRF-Token', csrfB)).status).toBe(404); });
  it('recalcula ao salvar, deriva idade histórica e evita duplicações no retry', async () => {
    const key = randomUUID(); const body = { patientId, evaluationDate: '2026-10-08', inputs: input };
    const r = await a.post('/api/v1/assessments').set('Origin', origin).set('X-CSRF-Token', csrfA).set('Idempotency-Key', key).send(body); expect(r.status).toBe(201); expect(r.body.ageYears).toBe(75); expect(r.body.result.displayValue).toBe('24,97'); assessmentId = r.body.id;
    const retry = await a.post('/api/v1/assessments').set('Origin', origin).set('X-CSRF-Token', csrfA).set('Idempotency-Key', key).send(body); expect(retry.status).toBe(200); expect(retry.body.id).toBe(assessmentId);
    const conflict = await a.post('/api/v1/assessments').set('Origin', origin).set('X-CSRF-Token', csrfA).set('Idempotency-Key', key).send({ ...body, evaluationDate: '2026-10-09' }); expect(conflict.status).toBe(409);
  });
  it('não aceita resultado nem userId do cliente e impede paciente alheio', async () => { const body = { patientId, evaluationDate: '2026-10-08', inputs: input }; expect((await a.post('/api/v1/assessments').set('Origin', origin).set('X-CSRF-Token', csrfA).set('Idempotency-Key', randomUUID()).send({ ...body, result: { muscleCircumferenceCm: 99 } })).status).toBe(422); expect((await b.post('/api/v1/assessments').set('Origin', origin).set('X-CSRF-Token', csrfB).set('Idempotency-Key', randomUUID()).send(body)).status).toBe(404); });
  it('B não consegue ler, alterar, excluir, auditar ou emitir relatório de A', async () => {
    for (const suffix of ['', '/report', '/audit']) expect((await b.get(`/api/v1/assessments/${assessmentId}${suffix}`)).status).toBe(404);
    expect((await b.patch(`/api/v1/assessments/${assessmentId}`).set('Origin', origin).set('X-CSRF-Token', csrfB).send({ patientId, evaluationDate: '2026-10-08', inputs: input, revision: 1 })).status).toBe(404);
    expect((await b.delete(`/api/v1/assessments/${assessmentId}`).set('Origin', origin).set('X-CSRF-Token', csrfB)).status).toBe(404);
  });
  it('pagina e filtra histórico, impede limite abusivo e bloqueia excluir paciente vinculado', async () => { const r = await a.get(`/api/v1/assessments?patientId=${patientId}&from=2026-10-08&to=2026-10-08&limit=1`); expect(r.body.total).toBe(1); expect(r.headers['cache-control']).toBe('no-store'); expect((await a.get('/api/v1/assessments?limit=101')).status).toBe(422); expect((await a.delete(`/api/v1/patients/${patientId}`).set('Origin', origin).set('X-CSRF-Token', csrfA)).status).toBe(409); });
  it('atualiza com recálculo, guarda snapshot anterior e impede revisão desatualizada', async () => { const body = { patientId, evaluationDate: '2026-10-09', inputs: { ...input, armCircumferenceCm: 31 }, revision: 1 }; const r = await a.patch(`/api/v1/assessments/${assessmentId}`).set('Origin', origin).set('X-CSRF-Token', csrfA).send(body); expect(r.status).toBe(200); expect(r.body.revision).toBe(2); expect(r.body.result.displayValue).toBe('25,97'); expect((await a.patch(`/api/v1/assessments/${assessmentId}`).set('Origin', origin).set('X-CSRF-Token', csrfA).send(body)).status).toBe(409); const audit = await a.get(`/api/v1/assessments/${assessmentId}/audit`); expect(audit.body.items.some((e: { snapshot?: { result: { displayValue: string } } }) => e.snapshot?.result.displayValue === '24,97')).toBe(true); });
  it('emite PDF real e restringe cache', async () => { const r = await a.get(`/api/v1/assessments/${assessmentId}/report`); expect(r.status).toBe(200); expect(r.type).toBe('application/pdf'); expect(r.headers['cache-control']).toBe('no-store'); expect(r.body.subarray(0, 5).toString()).toBe('%PDF-'); });
  it('exporta somente dados de A, sem hashes de senha ou sessões', async () => { const r = await a.get('/api/v1/account/export'); expect(r.body.assessments).toHaveLength(1); expect(r.body.user.passwordHash).toBeUndefined(); expect(r.body.sessions).toBeUndefined(); });
  it('exclui avaliação e snapshots de revisão', async () => { expect((await a.delete(`/api/v1/assessments/${assessmentId}`).set('Origin', origin).set('X-CSRF-Token', csrfA)).status).toBe(204); expect((await a.get(`/api/v1/assessments/${assessmentId}`)).status).toBe(404); const events = await db.auditEvent.findMany({ where: { entityId: assessmentId } }); expect(events).toHaveLength(1); expect(events[0].snapshot).toBeNull(); });
  it('revoga sessão ao sair', async () => { expect((await a.post('/api/v1/auth/logout').set('Origin', origin).set('X-CSRF-Token', csrfA)).status).toBe(204); expect((await a.get('/api/v1/auth/me')).status).toBe(401); });
});
