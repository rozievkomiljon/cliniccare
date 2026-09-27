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

/** Date `offset` days from now at `hourUTC`:00, skipping Sat/Sun. */
function nextBusinessDayAt(offset: number, hourUTC: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(hourUTC, 0, 0, 0);
  return d;
}

async function main(): Promise<void> {
  const passwordHash = await hashPassword("ChangeMe_2026!");

  const clinic = await prisma.clinic.upsert({
    where: { slug: "demo-clinic" },
    update: {},
    create: { name: "Demo Clinic", slug: "demo-clinic", timezone: "UTC" },
  });

  const users = new Map<string, { id: string; name: string }>();
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

  // Phase 3: doctor profile + weekly schedule + demo appointments.
  const doctorUser = users.get("doctor@cliniccare.local");
  if (!doctorUser) throw new Error("doctor@cliniccare.local must exist before doctor profile seeding");
  const doctor = await prisma.doctorProfile.upsert({
    where: { userId: doctorUser.id },
    update: { clinicId: clinic.id, specialization: "General Medicine", isDeleted: false },
    create: {
      userId: doctorUser.id,
      clinicId: clinic.id,
      specialization: "General Medicine",
      bio: "Family medicine with a focus on preventive care.",
      licenseNo: "LIC-2026-0001",
    },
  });

  // Mon-Fri 09:00-17:00, Sat 09:00-13:00 (minutes from midnight UTC), 30-min slots.
  const WEEK: Array<{ weekday: number; startMinute: number; endMinute: number; slotMinutes: number }> = [
    { weekday: 1, startMinute: 540, endMinute: 1020, slotMinutes: 30 },
    { weekday: 2, startMinute: 540, endMinute: 1020, slotMinutes: 30 },
    { weekday: 3, startMinute: 540, endMinute: 1020, slotMinutes: 30 },
    { weekday: 4, startMinute: 540, endMinute: 1020, slotMinutes: 30 },
    { weekday: 5, startMinute: 540, endMinute: 1020, slotMinutes: 30 },
    { weekday: 6, startMinute: 540, endMinute: 780, slotMinutes: 30 },
  ];
  for (const day of WEEK) {
    await prisma.doctorSchedule.upsert({
      where: { doctorId_weekday: { doctorId: doctor.id, weekday: day.weekday } },
      update: { startMinute: day.startMinute, endMinute: day.endMinute, slotMinutes: day.slotMinutes, isDeleted: false },
      create: { doctorId: doctor.id, ...day },
    });
  }

  // Demo appointments in the doctor's first week (skip when any already exist
  // so re-seeding stays idempotent).
  const hasAppointments = await prisma.appointment.findFirst({ where: { clinicId: clinic.id } });
  if (!hasAppointments) {
    const patientByMrn = (mrn: string) =>
      prisma.patient.findFirst({ where: { clinicId: clinic.id, mrn } });
    const [paul, maria, chen] = await Promise.all([
      patientByMrn("P-2026-00001"),
      patientByMrn("P-2026-00002"),
      patientByMrn("P-2026-00003"),
    ]);
    const receptionist = users.get("reception@cliniccare.local");
    const demo = [
      { patient: paul, offset: 1, hourUTC: 10, status: "CONFIRMED" as const, reason: "Annual check-up" },
      { patient: maria, offset: 2, hourUTC: 11, status: "PENDING" as const, reason: "Blood pressure follow-up" },
      { patient: chen, offset: 3, hourUTC: 14, status: "PENDING" as const, reason: "New patient consultation" },
    ];
    for (const d of demo) {
      if (!d.patient) continue;
      const appt = await prisma.appointment.create({
        data: {
          clinicId: clinic.id,
          doctorId: doctor.id,
          patientId: d.patient.id,
          scheduledAt: nextBusinessDayAt(d.offset, d.hourUTC),
          durationMinutes: 30,
          status: d.status,
          reason: d.reason,
          createdById: receptionist?.id ?? null,
          createdByName: receptionist?.name ?? "Front desk",
        },
      });
      await prisma.appointmentEvent.create({
        data: {
          appointmentId: appt.id,
          kind: "STAFF",
          actorUserId: receptionist?.id ?? null,
          actorName: receptionist?.name ?? "Front desk",
          type: "BOOKED",
          detail: d.reason,
        },
      });
    }
  }

  console.log(
    `Seeded clinic "${clinic.name}", ${ROLE_SEEDS.length} role users, ${DEMO_PATIENTS.length} patients, ${SERVICES.length} services, 1 doctor schedule, demo appointments.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
