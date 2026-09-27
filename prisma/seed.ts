/**
 * Phase 2 seed: demo clinic + one user per role + demo patients (one linked
 * to the portal account) + service catalog.
 * Passwords are argon2id-hashed via the app's password module.
 * Safe to re-run — upserts only (re-runs refresh password hashes).
 */
import { BloodGroup, PrismaClient, Role, Sex } from "@prisma/client";

import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient();

const ROLE_SEEDS: Array<{ role: Role; name: string; email: string }> = [
  { role: Role.SUPER_ADMIN, name: "Ada Super", email: "super@cliniccare.local" },
  { role: Role.CLINIC_ADMIN, name: "Alan Clinic Admin", email: "admin@cliniccare.local" },
  { role: Role.RECEPTIONIST, name: "Rita Reception", email: "reception@cliniccare.local" },
  { role: Role.DOCTOR, name: "Dr. Dana Doctor", email: "doctor@cliniccare.local" },
  { role: Role.NURSE, name: "Nora Nurse", email: "nurse@cliniccare.local" },
  { role: Role.LAB_TECH, name: "Luke Lab", email: "lab@cliniccare.local" },
  { role: Role.PHARMACIST, name: "Pia Pharma", email: "pharmacy@cliniccare.local" },
  { role: Role.ACCOUNTANT, name: "Alex Accounts", email: "accountant@cliniccare.local" },
  { role: Role.PATIENT, name: "Paul Patient", email: "patient@cliniccare.local" },
];

const DEMO_PATIENTS = [
  {
    mrn: "P-2026-00001",
    firstName: "Paul",
    lastName: "Patient",
    dateOfBirth: new Date("1990-04-12T00:00:00.000Z"),
    sex: Sex.MALE,
    phone: "+1 555 010 0001",
    email: "patient@cliniccare.local",
    city: "Springfield",
    bloodGroup: BloodGroup.O_POSITIVE,
    allergies: "Penicillin",
    chronicConditions: "Mild asthma",
    portalLinked: true,
  },
  {
    mrn: "P-2026-00002",
    firstName: "Maria",
    lastName: "Gonzalez",
    dateOfBirth: new Date("1985-09-23T00:00:00.000Z"),
    sex: Sex.FEMALE,
    phone: "+1 555 010 0002",
    city: "Springfield",
    bloodGroup: BloodGroup.A_POSITIVE,
    allergies: null,
    chronicConditions: "Hypertension",
    portalLinked: false,
  },
  {
    mrn: "P-2026-00003",
    firstName: "Chen",
    lastName: "Wei",
    dateOfBirth: new Date("1978-01-05T00:00:00.000Z"),
    sex: Sex.OTHER,
    phone: "+1 555 010 0003",
    city: "Riverside",
    bloodGroup: null,
    allergies: "Latex",
    chronicConditions: null,
    portalLinked: false,
  },
];

const SERVICES = [
  { name: "General consultation", category: "CONSULTATION", unitPrice: 5000 },
  { name: "Specialist consultation", category: "CONSULTATION", unitPrice: 9000 },
  { name: "Follow-up visit", category: "CONSULTATION", unitPrice: 3000 },
];

async function main(): Promise<void> {
  const passwordHash = await hashPassword("ChangeMe_2026!");

  const clinic = await prisma.clinic.upsert({
    where: { slug: "demo-clinic" },
    update: {},
    create: { name: "Demo Clinic", slug: "demo-clinic", timezone: "UTC" },
  });

  const users = new Map<string, { id: string }>();
  for (const seed of ROLE_SEEDS) {
    const user = await prisma.user.upsert({
      where: { email: seed.email },
      update: { passwordHash, isActive: true },
      create: {
        email: seed.email,
        passwordHash,
        name: seed.name,
        isSuperAdmin: seed.role === Role.SUPER_ADMIN,
      },
    });
    users.set(seed.email, user);
    await prisma.membership.upsert({
      where: { userId_clinicId: { userId: user.id, clinicId: clinic.id } },
      update: { role: seed.role },
      create: { userId: user.id, clinicId: clinic.id, role: seed.role },
    });
  }

  // Demo patients (idempotent by clinic+MRN).
  for (const p of DEMO_PATIENTS) {
    const patient = await prisma.patient.upsert({
      where: { clinicId_mrn: { clinicId: clinic.id, mrn: p.mrn } },
      update: {},
      create: {
        clinicId: clinic.id,
        mrn: p.mrn,
        firstName: p.firstName,
        lastName: p.lastName,
        dateOfBirth: p.dateOfBirth,
        sex: p.sex,
        phone: p.phone,
        email: p.email ?? null,
        city: p.city,
        bloodGroup: p.bloodGroup,
        allergies: p.allergies,
        chronicConditions: p.chronicConditions,
      },
    });
    if (p.portalLinked) {
      const portalUser = users.get("patient@cliniccare.local");
      if (portalUser) {
        await prisma.patientAccount.upsert({
          where: { userId: portalUser.id },
          update: { patientId: patient.id },
          create: { userId: portalUser.id, patientId: patient.id },
        });
      }
    }
  }

  // Service catalog.
  for (const s of SERVICES) {
    const existing = await prisma.serviceCatalogItem.findFirst({
      where: { clinicId: clinic.id, name: s.name },
    });
    if (!existing) {
      await prisma.serviceCatalogItem.create({
        data: { clinicId: clinic.id, name: s.name, category: s.category, unitPrice: s.unitPrice },
      });
    }
  }

  console.log(
    `Seeded clinic "${clinic.name}", ${ROLE_SEEDS.length} role users, ${DEMO_PATIENTS.length} patients, ${SERVICES.length} services.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
