-- CreateEnum
CREATE TYPE "EncounterKind" AS ENUM ('CONSULTATION', 'FOLLOW_UP', 'PROCEDURE', 'TELEHEALTH');

-- CreateEnum
CREATE TYPE "EncounterStatus" AS ENUM ('OPEN', 'SIGNED');

-- CreateEnum
CREATE TYPE "ClinicalNoteKind" AS ENUM ('NOTE', 'ADDENDUM', 'PROCEDURE');

-- CreateTable
CREATE TABLE "Encounter" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT,
    "appointmentId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "kind" "EncounterKind" NOT NULL DEFAULT 'CONSULTATION',
    "chiefComplaint" TEXT,
    "diagnosis" TEXT,
    "plan" TEXT,
    "status" "EncounterStatus" NOT NULL DEFAULT 'OPEN',
    "signedAt" TIMESTAMP(3),
    "signedByUserId" TEXT,
    "signedByName" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Encounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalNote" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "kind" "ClinicalNoteKind" NOT NULL DEFAULT 'NOTE',
    "body" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vital" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "systolic" INTEGER,
    "diastolic" INTEGER,
    "pulse" INTEGER,
    "temperature" DOUBLE PRECISION,
    "spo2" INTEGER,
    "weightKg" DOUBLE PRECISION,
    "heightCm" DOUBLE PRECISION,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vital_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Encounter_appointmentId_key" ON "Encounter"("appointmentId");

-- CreateIndex
CREATE INDEX "Encounter_clinicId_occurredAt_idx" ON "Encounter"("clinicId", "occurredAt");

-- CreateIndex
CREATE INDEX "Encounter_patientId_occurredAt_idx" ON "Encounter"("patientId", "occurredAt");

-- CreateIndex
CREATE INDEX "Encounter_doctorId_occurredAt_idx" ON "Encounter"("doctorId", "occurredAt");

-- CreateIndex
CREATE INDEX "ClinicalNote_clinicId_patientId_createdAt_idx" ON "ClinicalNote"("clinicId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClinicalNote_encounterId_createdAt_idx" ON "ClinicalNote"("encounterId", "createdAt");

-- CreateIndex
CREATE INDEX "Vital_clinicId_patientId_recordedAt_idx" ON "Vital"("clinicId", "patientId", "recordedAt");

-- CreateIndex
CREATE INDEX "Vital_encounterId_recordedAt_idx" ON "Vital"("encounterId", "recordedAt");

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vital" ADD CONSTRAINT "Vital_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vital" ADD CONSTRAINT "Vital_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vital" ADD CONSTRAINT "Vital_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
