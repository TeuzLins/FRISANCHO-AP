-- Additive evolution. UTC is the convention used by the previous Prisma schema.
ALTER TABLE "User" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active', ADD COLUMN "updatedAt" TIMESTAMPTZ(3);
UPDATE "User" SET "updatedAt" = "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "User" ALTER COLUMN "updatedAt" SET NOT NULL, ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
 ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "User" ADD CONSTRAINT "User_status_check" CHECK ("status" IN ('active', 'disabled'));
ALTER TABLE "Session" ADD COLUMN "revokedAt" TIMESTAMPTZ(3), ADD COLUMN "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3) USING "expiresAt" AT TIME ZONE 'UTC';
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
ALTER TABLE "Patient" ADD COLUMN "archivedAt" TIMESTAMPTZ(3), ADD COLUMN "updatedAt" TIMESTAMPTZ(3);
UPDATE "Patient" SET "updatedAt" = "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "Patient" ALTER COLUMN "updatedAt" SET NOT NULL, ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
 ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
 ALTER COLUMN "birthDate" TYPE DATE USING "birthDate"::date;
CREATE UNIQUE INDEX "Patient_id_userId_key" ON "Patient"("id", "userId");
CREATE INDEX "Patient_userId_archivedAt_idx" ON "Patient"("userId", "archivedAt");
ALTER TABLE "ReferenceDataset" ADD COLUMN "key" TEXT;
UPDATE "ReferenceDataset" SET "key" = "id";
ALTER TABLE "ReferenceDataset" ALTER COLUMN "key" SET NOT NULL;
CREATE UNIQUE INDEX "ReferenceDataset_key_version_key" ON "ReferenceDataset"("key", "version");
ALTER TABLE "Assessment" ADD COLUMN "patientSnapshot" JSONB;
UPDATE "Assessment" a SET "patientSnapshot" = jsonb_build_object('id', p."id", 'identifier', p."identifier", 'displayName', p."displayName", 'birthDate', p."birthDate", 'referenceSex', p."referenceSex") FROM "Patient" p WHERE p."id" = a."patientId";
ALTER TABLE "Assessment" ALTER COLUMN "patientSnapshot" SET NOT NULL,
 ALTER COLUMN "evaluationDate" TYPE DATE USING "evaluationDate"::date,
 ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
 ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "Assessment" DROP CONSTRAINT "Assessment_patientId_fkey";
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_patientId_userId_fkey" FOREIGN KEY ("patientId", "userId") REFERENCES "Patient"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_measurements_check" CHECK (COALESCE((
 "ageYears" >= 0 AND "revision" > 0 AND
 jsonb_typeof("inputs"->'armCircumferenceCm') = 'number' AND jsonb_typeof("inputs"->'tricepsSkinfoldMm') = 'number' AND
 ("inputs"->>'armCircumferenceCm')::double precision > 0 AND ("inputs"->>'tricepsSkinfoldMm')::double precision > 0 AND
 ("inputs"->>'armCircumferenceCm')::double precision - pi() * (("inputs"->>'tricepsSkinfoldMm')::double precision / 10) > 0 AND
 jsonb_typeof("result"->'muscleCircumferenceCm') = 'number' AND ("result"->>'muscleCircumferenceCm')::double precision > 0 AND
 COALESCE(("inputs"->>'reportedMuscleCircumferenceCm')::double precision > 0, true) AND
 COALESCE(("inputs"->>'weightKg')::double precision > 0, true) AND COALESCE(("inputs"->>'heightCm')::double precision > 0, true)
), false));
CREATE INDEX "Assessment_userId_evaluationDate_idx" ON "Assessment"("userId", "evaluationDate");
ALTER TABLE "AuditEvent" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
CREATE TABLE "IdempotencyRecord" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "operation" TEXT NOT NULL, "key" TEXT NOT NULL, "requestHash" TEXT NOT NULL, "hashVersion" TEXT NOT NULL DEFAULT 'canonical-v1',
 "response" JSONB, "entityId" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE UNIQUE INDEX "IdempotencyRecord_userId_operation_key_key" ON "IdempotencyRecord"("userId", "operation", "key");
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");
CREATE INDEX "IdempotencyRecord_userId_entityId_idx" ON "IdempotencyRecord"("userId", "entityId");
-- Old hashes are explicitly distinguished from the new canonical JSON algorithm.
INSERT INTO "IdempotencyRecord" ("id", "userId", "operation", "key", "requestHash", "hashVersion", "response", "entityId", "createdAt", "expiresAt")
 SELECT "id", "userId", 'assessment:create', "idempotencyKey", "requestHash", 'legacy-json',
 (to_jsonb(a) - 'patientSnapshot') || jsonb_build_object('evaluationDate', to_char("evaluationDate", 'YYYY-MM-DD'), 'patient', "patientSnapshot"), "id", "createdAt", "createdAt" + interval '7 days' FROM "Assessment" a;

DROP INDEX "Assessment_userId_idempotencyKey_key";
