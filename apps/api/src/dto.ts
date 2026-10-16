import type { Patient, Assessment, AuditEvent } from '@prisma/client';
export const civilDate = (value: Date | null) => value ? value.toISOString().slice(0, 10) : null;
export const dateInput = (value: string) => new Date(value + 'T00:00:00.000Z');
export function patientDTO(p: Patient & { _count?: { assessments: number } }) {
  return { id: p.id, identifier: p.identifier, displayName: p.displayName, birthDate: civilDate(p.birthDate), referenceSex: p.referenceSex, archivedAt: p.archivedAt?.toISOString() || null, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(), ...(p._count ? { _count: p._count } : {}) };
}
export function patientSnapshot(p: Patient) {
  const { id, identifier, displayName, birthDate, referenceSex } = patientDTO(p);
  return { id, identifier, displayName, birthDate, referenceSex };
}
export function assessmentDTO(a: Assessment & { patient?: Patient }) {
  return { id: a.id, patientId: a.patientId, patient: a.patientSnapshot, evaluationDate: civilDate(a.evaluationDate)!, ageYears: a.ageYears, inputs: a.inputs, result: a.result, referenceId: a.referenceId, engineVersion: a.engineVersion, revision: a.revision, createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString() };
}
export const auditDTO = (e: AuditEvent) => ({ id: e.id, entityId: e.entityId, action: e.action, snapshot: e.snapshot, createdAt: e.createdAt.toISOString() });
export function storedAssessmentResponse(value: unknown) {
  const row = value as Record<string, unknown>;
  // Legacy POST responses contained Prisma-internal ownership/idempotency fields.
  return Object.fromEntries(['id', 'patientId', 'patient', 'evaluationDate', 'ageYears', 'inputs', 'result', 'referenceId', 'engineVersion', 'revision', 'createdAt', 'updatedAt'].filter(key => key in row).map(key => [key, row[key]]));
}
