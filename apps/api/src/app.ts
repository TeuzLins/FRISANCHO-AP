import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { calculate, calculationSchema, referenceProviders, ageOnDate, ENGINE_VERSION } from '@frisancho/anthropometry';
import { config } from './config.js';
import { sendReport } from './report.js';
import { openapi } from './openapi.js';

import { db, databaseReady } from './database.js';
import { patientDTO, patientSnapshot, assessmentDTO, auditDTO, civilDate, dateInput, storedAssessmentResponse } from './dto.js';
import { payloadHash, databaseErrorCategory } from '@frisancho/database';
export { db };
export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxyHops);
app.use(helmet());
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
type Auth = { userId: string; sessionId: string; csrfToken: string };
const auths = new WeakMap<Request, Auth>();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const fail = (status: number, code: string, message: string): never => { throw new ApiError(status, code, message); };
const cookieName = config.production ? '__Host-frisancho' : 'frisancho';
const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'lax' as const, path: '/' };
const authInput = z.object({ email: z.string().trim().pipe(z.email().max(254)).transform(v => v.toLowerCase()), password: z.string().min(12, 'Use pelo menos 12 caracteres.').max(128), name: z.string().trim().min(2).max(100).optional() }).strict();
const patientInput = z.object({ identifier: z.string().trim().min(1).max(80), displayName: z.string().trim().min(1).max(120), birthDate: z.iso.date().nullable().default(null), referenceSex: z.enum(['male', 'female']).nullable().default(null) }).strict();
const assessmentInput = z.object({ patientId: z.uuid(), evaluationDate: z.iso.date(), inputs: calculationSchema, revision: z.number().int().positive().optional() }).strict();
const pagination = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), q: z.string().max(120).optional(), patientId: z.uuid().optional(), from: z.iso.date().optional(), to: z.iso.date().optional(), order: z.enum(['asc', 'desc']).default('desc') });
const limiter = (limit: number) => rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.', fields: {} } } });
const loginLimit = limiter(20);
function origin(req: Request, _res: Response, next: NextFunction) {
  if (req.get('origin') !== config.origin) return next(new ApiError(403, 'ORIGIN_REJECTED', 'Origem da requisição não permitida.'));
  next();
}
async function authenticated(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies[cookieName];
    if (typeof token !== 'string' || token.length !== 64) fail(401, 'UNAUTHORIZED', 'Entre na sua conta para continuar.');
    const session = await db.session.findUnique({ where: { tokenHash: hash(token) }, include: { user: { select: { status: true } } } });
    if (!session || session.revokedAt || session.user.status !== 'active' || session.expiresAt <= new Date()) return fail(401, 'UNAUTHORIZED', 'Sessão expirada. Entre novamente.');
    auths.set(req, { userId: session.userId, sessionId: session.id, csrfToken: session.csrfToken });
    next();
  } catch (error) { next(error); }
}
function csrf(req: Request, res: Response, next: NextFunction) {
  origin(req, res, (error?: unknown) => {
    if (error) return next(error);
    const expected = auths.get(req)!.csrfToken;
    const actual = req.get('x-csrf-token') || '';
    if (!/^[a-f0-9]{64}$/.test(actual) || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return next(new ApiError(403, 'CSRF_REJECTED', 'Atualize a página e tente novamente.'));
    next();
  });
}
const userId = (req: Request) => auths.get(req)!.userId;
function assessmentResult(inputs: z.infer<typeof calculationSchema>, birthDate: string | null, evaluationDate: string) {
  let ageYears = inputs.ageYears;
  if (birthDate) try { ageYears = ageOnDate(birthDate, evaluationDate); } catch (error) { throw new z.ZodError([{ code: 'custom', path: ['evaluationDate'], message: (error as Error).message }]); }
  return calculate({ ...inputs, ageYears });
}
const ownPatient = async (id: string, uid: string) => {
  const patient = await db.patient.findFirst({ where: { id, userId: uid } });
  return patient || fail(404, 'NOT_FOUND', 'Paciente não encontrado.');
};
const ownAssessment = async (id: string, uid: string) => {
  const assessment = await db.assessment.findFirst({ where: { id, userId: uid }, include: { patient: true } });
  return assessment || fail(404, 'NOT_FOUND', 'Avaliação não encontrada.');
};
async function newSession(req: Request, res: Response, user: { id: string; email: string; name: string }) {
  const token = randomBytes(32).toString('hex');
  const csrfToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + config.sessionDays * 86400000);
  const oldToken = req.cookies[cookieName];
  await db.$transaction(async tx => {
    if (typeof oldToken === 'string') await tx.session.updateMany({ where: { tokenHash: hash(oldToken) }, data: { revokedAt: new Date() } });
    await tx.session.create({ data: { tokenHash: hash(token), csrfToken, expiresAt, userId: user.id } });
  });
  res.cookie(cookieName, token, { ...cookieOptions, expires: expiresAt });
  res.json({ user: { id: user.id, email: user.email, name: user.name }, csrfToken });
}
app.get('/api/v1/live', (_req, res) => res.json({ status: 'ok' }));
app.get(['/api/v1/ready', '/api/v1/health'], async (_req, res) => {
  if (await databaseReady()) res.json({ status: 'ok', database: 'connected', engineVersion: ENGINE_VERSION });
  else res.status(503).json({ status: 'degraded', database: 'unavailable', calculationAvailable: true });
});
app.get('/api/v1/openapi.json', (_req, res) => res.json(openapi));
app.get('/api/v1/references', (_req, res) => res.json({ items: referenceProviders.map(p => p.metadata) }));
app.post('/api/v1/calculations/cmb', limiter(150), (req, res) => res.json(calculate(req.body)));
app.post('/api/v1/auth/register', loginLimit, origin, async (req, res) => {
  const body = authInput.extend({ name: z.string().trim().min(2).max(100) }).parse(req.body);
  const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  const user = await db.user.create({ data: { email: body.email, name: body.name, passwordHash } });
  res.status(201);
  await newSession(req, res, user);
});
// A fixed dummy hash prevents missing-email attempts from skipping password hashing work.
const dummyHash = argon2.hash(randomBytes(32), { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
app.post('/api/v1/auth/login', loginLimit, origin, async (req, res) => {
  const body = authInput.omit({ name: true }).parse(req.body);
  const user = await db.user.findUnique({ where: { email: body.email } });
  const valid = await argon2.verify(user?.passwordHash || await dummyHash, body.password);
  if (!user || user.status !== 'active' || !valid) return fail(401, 'INVALID_CREDENTIALS', 'E-mail ou senha incorretos.');
  await newSession(req, res, user);
});
app.get('/api/v1/auth/me', authenticated, async (req, res) => {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId(req) }, select: { id: true, email: true, name: true } });
  res.json({ user, csrfToken: auths.get(req)!.csrfToken });
});
app.post('/api/v1/auth/logout', authenticated, csrf, async (req, res) => {
  await db.session.update({ where: { id: auths.get(req)!.sessionId }, data: { revokedAt: new Date() } });
  res.clearCookie(cookieName, cookieOptions).status(204).end();
});
app.get('/api/v1/patients', authenticated, async (req, res) => {
  const { page, limit, q } = pagination.parse(req.query);
  const archived = z.enum(['active', 'archived', 'all']).default('active').parse(req.query.archived);
  const where: Prisma.PatientWhereInput = { userId: userId(req), ...(archived === 'all' ? {} : { archivedAt: archived === 'active' ? null : { not: null } }), ...(q ? { OR: [{ displayName: { contains: q, mode: 'insensitive' } }, { identifier: { contains: q, mode: 'insensitive' } }] } : {}) };
  const [items, total] = await db.$transaction([db.patient.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: [{ displayName: 'asc' }, { id: 'asc' }], include: { _count: { select: { assessments: true } } } }), db.patient.count({ where })]);
  res.json({ items: items.map(patientDTO), total, page, limit });
});
app.post('/api/v1/patients', authenticated, csrf, async (req, res) => {
  const data = patientInput.parse(req.body);
  const patient = await db.$transaction(async tx => {
    const patient = await tx.patient.create({ data: { ...data, birthDate: data.birthDate ? dateInput(data.birthDate) : null, userId: userId(req) } });
    await tx.auditEvent.create({ data: { userId: userId(req), entityId: patient.id, action: 'PATIENT_CREATED' } });
    return patient;
  });
  res.status(201).json(patientDTO(patient));
});
app.get('/api/v1/patients/:id', authenticated, async (req, res) => res.json(patientDTO(await ownPatient(String(req.params.id), userId(req)))));
app.patch('/api/v1/patients/:id', authenticated, csrf, async (req, res) => {
  const patient = await ownPatient(String(req.params.id), userId(req));
  const data = patientInput.omit({ birthDate: true, referenceSex: true }).partial().extend({ birthDate: z.iso.date().nullable().optional(), referenceSex: z.enum(['male', 'female']).nullable().optional(), archived: z.boolean().optional() }).parse(req.body);
  const { archived, birthDate, ...fields } = data;
  const updated = await db.$transaction(async tx => {
    const updated = await tx.patient.update({ where: { id: patient.id, userId: userId(req) }, data: { ...fields, ...(birthDate !== undefined ? { birthDate: birthDate ? dateInput(birthDate) : null } : {}), ...(archived !== undefined ? { archivedAt: archived ? patient.archivedAt || new Date() : null } : {}) } });
    await tx.auditEvent.create({ data: { userId: userId(req), entityId: patient.id, action: archived === undefined ? 'PATIENT_UPDATED' : archived ? 'PATIENT_ARCHIVED' : 'PATIENT_RESTORED' } });
    return updated;
  });
  res.json(patientDTO(updated));
});
app.delete('/api/v1/patients/:id', authenticated, csrf, async (req, res) => {
  const patient = await ownPatient(String(req.params.id), userId(req));
  if (await db.assessment.count({ where: { patientId: patient.id, userId: userId(req) } })) fail(409, 'PATIENT_HAS_ASSESSMENTS', 'Exclua as avaliações deste paciente antes de excluir seu cadastro.');
  await db.$transaction(async tx => {
    await tx.patient.delete({ where: { id: patient.id, userId: userId(req) } });
    await tx.auditEvent.deleteMany({ where: { userId: userId(req), entityId: patient.id } });
    await tx.auditEvent.create({ data: { userId: userId(req), entityId: patient.id, action: 'PATIENT_DELETED' } });
  });
  res.status(204).end();
});
async function referenceRecord(tx: Prisma.TransactionClient, result: ReturnType<typeof calculate>) {
  const r = result.reference;
  return tx.referenceDataset.upsert({ where: { key_version: { key: r.id, version: r.version } }, create: { id: r.id + '@' + r.version, key: r.id, version: r.version, metadata: json(r) }, update: {} });
}
async function idempotent(uid: string, operation: string, key: string | undefined, body: unknown, work: (tx: Prisma.TransactionClient) => Promise<ReturnType<typeof assessmentDTO>>) {
  return db.$transaction(async tx => {
    if (key) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${uid + ':' + operation + ':' + key}, 0))`;
      const old = await tx.idempotencyRecord.findUnique({ where: { userId_operation_key: { userId: uid, operation, key } } });
      if (old && old.expiresAt > new Date()) {
        const digest = old.hashVersion === 'legacy-json' ? hash(JSON.stringify(body)) : payloadHash(body);
        if (old.requestHash !== digest) fail(409, 'IDEMPOTENCY_CONFLICT', 'Esta tentativa já foi usada para uma avaliação diferente.');
        if (old.response === null) fail(410, 'ASSESSMENT_ERASED', 'O registro desta tentativa foi excluído.');
        return { response: storedAssessmentResponse(old.response), replayed: true };
      }
      if (old) await tx.idempotencyRecord.delete({ where: { id: old.id } });
    }
    const response = await work(tx);
    if (key) await tx.idempotencyRecord.create({ data: { userId: uid, operation, key, requestHash: payloadHash(body), response: json(response), entityId: response.id, expiresAt: new Date(Date.now() + 7 * 86400000) } });
    return { response, replayed: false };
  });
}
app.get('/api/v1/assessments', authenticated, async (req, res) => {
  const { page, limit, patientId, from, to, order } = pagination.parse(req.query);
  const where: Prisma.AssessmentWhereInput = { userId: userId(req), ...(patientId ? { patientId } : {}), ...(from || to ? { evaluationDate: { gte: from ? dateInput(from) : undefined, lte: to ? dateInput(to) : undefined } } : {}) };
  const [items, total] = await db.$transaction([db.assessment.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: [{ evaluationDate: order }, { id: order }] }), db.assessment.count({ where })]);
  res.json({ items: items.map(assessmentDTO), total, page, limit });
});
app.post('/api/v1/assessments', authenticated, csrf, async (req, res) => {
  const body = assessmentInput.omit({ revision: true }).parse(req.body);
  const key = z.uuid().parse(req.get('idempotency-key')); const uid = userId(req);
  const saved = await idempotent(uid, 'assessment:create', key, body, async tx => {
    const patient = await tx.patient.findFirst({ where: { id: body.patientId, userId: uid } });
    if (!patient) fail(404, 'NOT_FOUND', 'Paciente não encontrado.');
    if (patient!.archivedAt) fail(409, 'PATIENT_ARCHIVED', 'Reative o paciente antes de criar uma avaliação.');
    const result = assessmentResult(body.inputs, civilDate(patient!.birthDate), body.evaluationDate);
    const ref = await referenceRecord(tx, result);
    const item = await tx.assessment.create({ data: { userId: uid, patientId: patient!.id, patientSnapshot: json(patientSnapshot(patient!)), evaluationDate: dateInput(body.evaluationDate), ageYears: result.input.ageYears, inputs: json(result.input), result: json(result), referenceId: ref.id, engineVersion: result.engineVersion, idempotencyKey: key, requestHash: payloadHash(body) } });
    await tx.auditEvent.create({ data: { userId: uid, entityId: item.id, action: 'ASSESSMENT_CREATED' } });
    return assessmentDTO(item);
  });
  res.status(saved.replayed ? 200 : 201).json(saved.response);
});
app.get('/api/v1/assessments/:id', authenticated, async (req, res) => res.json(assessmentDTO(await ownAssessment(String(req.params.id), userId(req)))));
app.patch('/api/v1/assessments/:id', authenticated, csrf, async (req, res) => {
  const body = assessmentInput.extend({ revision: z.number().int().positive() }).parse(req.body);
  const key = z.uuid().optional().parse(req.get('idempotency-key')); const uid = userId(req); const id = String(req.params.id);
  const saved = await idempotent(uid, 'assessment:update:' + id, key, body, async tx => {
    const before = await tx.assessment.findFirst({ where: { id, userId: uid } });
    const patient = await tx.patient.findFirst({ where: { id: body.patientId, userId: uid } });
    if (!before || !patient) fail(404, 'NOT_FOUND', 'Registro não encontrado.');
    if (patient!.archivedAt && before!.patientId !== patient!.id) fail(409, 'PATIENT_ARCHIVED', 'Reative o paciente antes de vinculá-lo.');
    const result = assessmentResult(body.inputs, civilDate(patient!.birthDate), body.evaluationDate);
    const ref = await referenceRecord(tx, result);
    const updated = await tx.assessment.updateMany({ where: { id, userId: uid, revision: body.revision }, data: { patientId: patient!.id, patientSnapshot: before!.patientId === patient!.id ? json(before!.patientSnapshot) : json(patientSnapshot(patient!)), evaluationDate: dateInput(body.evaluationDate), ageYears: result.input.ageYears, inputs: json(result.input), result: json(result), engineVersion: result.engineVersion, referenceId: ref.id, revision: { increment: 1 } } });
    if (!updated.count) fail(409, 'REVISION_CONFLICT', 'A avaliação foi alterada em outra sessão. Atualize o histórico antes de editar.');
    await tx.auditEvent.create({ data: { userId: uid, entityId: id, action: 'ASSESSMENT_UPDATED', snapshot: json(assessmentDTO(before!)) } });
    return assessmentDTO(await tx.assessment.findUniqueOrThrow({ where: { id } }));
  });
  res.json(saved.response);
});
app.delete('/api/v1/assessments/:id', authenticated, csrf, async (req, res) => {
  const item = await ownAssessment(String(req.params.id), userId(req));
  await db.$transaction(async tx => {
    await tx.assessment.delete({ where: { id: item.id, userId: userId(req) } });
    await tx.idempotencyRecord.updateMany({ where: { entityId: item.id, userId: userId(req) }, data: { response: Prisma.DbNull } });
    // Erasure removes revision snapshots as well; only a metadata-only deletion event remains.
    await tx.auditEvent.deleteMany({ where: { entityId: item.id, userId: userId(req) } });
    await tx.auditEvent.create({ data: { userId: userId(req), entityId: item.id, action: 'ASSESSMENT_DELETED' } });
  });
  res.status(204).end();
});
app.get('/api/v1/assessments/:id/report', authenticated, async (req, res) => sendReport(res, assessmentDTO(await ownAssessment(String(req.params.id), userId(req)))));
app.get('/api/v1/assessments/:id/audit', authenticated, async (req, res) => {
  const item = await ownAssessment(String(req.params.id), userId(req));
  res.json({ items: (await db.auditEvent.findMany({ where: { entityId: item.id, userId: userId(req) }, orderBy: { createdAt: 'desc' } })).map(auditDTO) });
});
app.get('/api/v1/account/export', authenticated, async (req, res) => {
  const uid = userId(req);
  const [user, patients, assessments, auditEvents] = await db.$transaction([
    db.user.findUnique({ where: { id: uid }, select: { id: true, name: true, email: true, createdAt: true } }),
    db.patient.findMany({ where: { userId: uid } }), db.assessment.findMany({ where: { userId: uid } }), db.auditEvent.findMany({ where: { userId: uid } }),
  ]);
  res.setHeader('Content-Disposition', 'attachment; filename="frisancho-dados.json"');
  res.json({ exportedAt: new Date().toISOString(), user: user && { ...user, createdAt: user.createdAt.toISOString() }, patients: patients.map(patientDTO), assessments: assessments.map(assessmentDTO), auditEvents: auditEvents.map(auditDTO) });
});
app.delete('/api/v1/account', authenticated, csrf, async (req, res) => {
  const body = z.object({ password: z.string().max(128), confirmation: z.literal('EXCLUIR') }).strict().parse(req.body);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId(req) } });
  if (!await argon2.verify(user.passwordHash, body.password)) fail(401, 'INVALID_CREDENTIALS', 'Senha incorreta.');
  await db.$transaction(async tx => {
    await tx.assessment.deleteMany({ where: { userId: user.id } });
    await tx.user.delete({ where: { id: user.id } });
  });
  res.clearCookie(cookieName, cookieOptions).status(204).end();
});
app.use('/api', (_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Rota da API não encontrada.')));
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
app.use('/assets', express.static(path.join(webRoot, 'assets'), { maxAge: '1y', immutable: true }));
app.use(express.static(webRoot, { maxAge: 0, setHeaders(res, file) { if (/[-.][a-zA-Z0-9]{8,}\.(js|css|woff2)$/.test(path.basename(file))) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
app.get('/{*path}', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(webRoot, 'index.html')); });
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  if (error instanceof z.ZodError) return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Confira os campos indicados.', fields: z.flattenError(error).fieldErrors, issues: error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) } });
  if (error instanceof ApiError) return res.status(error.status).json({ error: { code: error.code, message: error.message, fields: {} } });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return res.status(409).json({ error: { code: 'DUPLICATE_RECORD', message: 'Este e-mail ou identificador já está cadastrado.', fields: {} } });
    if (['P2025', 'P2003'].includes(error.code)) return res.status(409).json({ error: { code: 'RECORD_CONFLICT', message: 'O registro foi alterado ou ainda possui vínculos. Atualize a página.', fields: {} } });
  }
  const status = (error as { status?: number })?.status;
  if (status === 413 || status === 400) return res.status(status).json({ error: { code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON', message: 'Corpo da requisição inválido ou muito grande.', fields: {} } });
  // Never log request bodies, cookies, SQL errors, credentials or patient data.
  console.error('API_ERROR', databaseErrorCategory(error));
  res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Serviço temporariamente indisponível. Seus dados digitados foram preservados; tente novamente.', fields: {} } });
});
