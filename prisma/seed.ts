/**
 * Phase 0 seed: demo clinic + one user per role (password: ChangeMe_2026!).
 * Safe to re-run — upserts only.
 *
 * Password hashing uses node:crypto scrypt for now; Argon2id arrives with the
 * auth module in Phase 1 (seed hashes are re-set then).
 */
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

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

async function main(): Promise<void> {
  const passwordHash = await hashPassword("ChangeMe_2026!");

  const clinic = await prisma.clinic.upsert({
    where: { slug: "demo-clinic" },
    update: {},
    create: { name: "Demo Clinic", slug: "demo-clinic", timezone: "UTC" },
  });

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
    await prisma.membership.upsert({
      where: { userId_clinicId: { userId: user.id, clinicId: clinic.id } },
      update: { role: seed.role },
      create: { userId: user.id, clinicId: clinic.id, role: seed.role },
    });
  }

  console.log(`Seeded clinic "${clinic.name}" and ${ROLE_SEEDS.length} role users.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
