/**
 * Service-level integration tests (Postgres-backed): auth services, staff
 * management, transactional audit rows, and cross-clinic isolation. These
 * exercise the same code paths the server actions invoke.
 */
import { afterAll, describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createToken } from "@/lib/auth/tokens";
import { db } from "@/lib/db";
import { recordAudit } from "@/features/audit/service";
import {
  requestPasswordReset,
  resetPassword,
  verifyCredentials,
  verifyEmail,
} from "@/features/auth/service";
import { createStaffUser, updateStaffRole, deactivateStaff } from "@/features/staff/service";
import { ForbiddenError } from "@/lib/errors";

const DB_AVAILABLE = await (async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
})();
const CI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const hasDb = DB_AVAILABLE || CI;

const suffix = process.env.GITHUB_RUN_ID ?? "local";
const testClinicA = `itest-a-${suffix}`;
const testClinicB = `itest-b-${suffix}`;
const EMAIL_DOMAIN = "@itest.local";

async function ensureClinic(slug: string) {
  return db.clinic.upsert({
    where: { slug },
    update: {},
    create: { name: `ITest ${slug}`, slug, timezone: "UTC" },
  });
}

async function makeUser(email: string, name: string) {
  const passwordHash = await hashPassword("Sup3r$ecret!pw");
  return db.user.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, name, passwordHash },
  });
}

describe.skipIf(!hasDb)("credential verification (real login logic)", () => {
  it("accepts correct credentials for an active user and audits success", async () => {
    const email = `login-${suffix}${EMAIL_DOMAIN}`;
    const user = await makeUser(email, "Login Tester");

    const ok = await verifyCredentials(email, "Sup3r$ecret!pw");
    expect(ok?.id).toBe(user.id);
    const audit = await db.auditLog.findFirst({
      where: { actorUserId: user.id, action: "auth.login.success" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
  });

  it("rejects wrong passwords without a reason and audits failure", async () => {
    const email = `login2-${suffix}${EMAIL_DOMAIN}`;
    const user = await makeUser(email, "Login Tester 2");

    expect(await verifyCredentials(email, "wrong-password")).toBeNull();
    const audit = await db.auditLog.findFirst({
      where: { actorUserId: user.id, action: "auth.login.failed" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
  });

  it("rejects unknown emails and disabled accounts", async () => {
    expect(await verifyCredentials(`ghost-${suffix}${EMAIL_DOMAIN}`, "whatever")).toBeNull();

    const email = `disabled-${suffix}${EMAIL_DOMAIN}`;
    const user = await makeUser(email, "Disabled Tester");
    await db.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect(await verifyCredentials(email, "Sup3r$ecret!pw")).toBeNull();
  });
});

describe.skipIf(!hasDb)("auth services", () => {
  it("requestPasswordReset creates a single-use token without leaking existence", async () => {
    const user = await makeUser(`reset-${suffix}${EMAIL_DOMAIN}`, "Reset Tester");
    const missing = await requestPasswordReset(`nobody-${suffix}${EMAIL_DOMAIN}`);
    expect(missing).toEqual({ ok: true }); // no enumeration

    await requestPasswordReset(user.email);
    const stored = await db.passwordResetToken.findFirst({ where: { userId: user.id } });
    expect(stored).not.toBeNull();
    expect(stored?.usedAt).toBeNull();
  });

  it("resetPassword swaps the hash, consumes the token, revokes sessions", async () => {
    const user = await makeUser(`reset2-${suffix}${EMAIL_DOMAIN}`, "Reset Tester 2");
    await db.session.create({
      data: {
        userId: user.id,
        sessionToken: `st-${suffix}-${Date.now()}`,
        expires: new Date(Date.now() + 3600_000),
      },
    });

    // Create the token directly so the test holds the raw value (as an email link would).
    const { token, tokenHash } = createToken();
    await db.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 600_000) },
    });

    await resetPassword(token, await hashPassword("Br@ndNew!pass1"));

    const updated = await db.user.findUnique({ where: { id: user.id } });
    expect(await verifyPassword(updated!.passwordHash, "Br@ndNew!pass1")).toBe(true);
    expect((await db.session.findMany({ where: { userId: user.id } })).length).toBe(0);
    expect((await db.passwordResetToken.findUnique({ where: { tokenHash } }))?.usedAt).not.toBeNull();
  });

  it("rejects unknown and reused reset tokens", async () => {
    const { token, tokenHash } = createToken();
    const user = await makeUser(`reset3-${suffix}${EMAIL_DOMAIN}`, "Reset Tester 3");
    await db.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 600_000) },
    });

    await resetPassword(token, await hashPassword("An0ther!pass1"));
    await expect(resetPassword(token, await hashPassword("An0ther!pass2"))).rejects.toThrow();
    await expect(resetPassword("nonexistent-token", await hashPassword("An0ther!pass3"))).rejects.toThrow();
  });

  it("verifies email tokens single-use", async () => {
    const user = await makeUser(`verify-${suffix}${EMAIL_DOMAIN}`, "Verify Tester");
    const { token, tokenHash } = createToken();
    await db.emailVerificationToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 600_000) },
    });

    await verifyEmail(token);
    expect((await db.user.findUnique({ where: { id: user.id } }))?.emailVerifiedAt).not.toBeNull();
    await expect(verifyEmail(token)).rejects.toThrow();
  });
});

describe.skipIf(!hasDb)("staff management services", () => {
  it("creates staff with a transactional audit row and invite token", async () => {
    const clinic = await ensureClinic(testClinicA);
    const admin = await makeUser(`admin-${suffix}${EMAIL_DOMAIN}`, "ITest Admin");

    const { verificationToken } = await db.$transaction(async (tx) =>
      createStaffUser(tx, {
        name: "New Nurse",
        email: `nurse-${suffix}${EMAIL_DOMAIN}`,
        role: "NURSE",
        clinicId: clinic.id,
        actorUserId: admin.id,
      }),
    );

    expect(verificationToken).toBeTruthy();
    const audits = await db.auditLog.findMany({
      where: { clinicId: clinic.id, action: "staff.user.created" },
    });
    expect(audits.length).toBe(1);
  });

  it("updates roles with before/after audit", async () => {
    const clinic = await ensureClinic(testClinicA);
    const admin = await makeUser(`admin2-${suffix}${EMAIL_DOMAIN}`, "ITest Admin 2");
    const nurse = (await db.user.findUnique({ where: { email: `nurse-${suffix}${EMAIL_DOMAIN}` } }))!;

    await db.$transaction(async (tx) =>
      updateStaffRole(tx, {
        userId: nurse.id,
        role: "RECEPTIONIST",
        clinicId: clinic.id,
        actorUserId: admin.id,
      }),
    );

    const audit = await db.auditLog.findFirst({
      where: { clinicId: clinic.id, action: "staff.role.updated" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.before).toEqual({ role: "NURSE" });
    expect(audit?.after).toEqual({ role: "RECEPTIONIST" });
  });

  it("blocks self-deactivation", async () => {
    const clinic = await ensureClinic(testClinicA);
    const admin = await makeUser(`admin3-${suffix}${EMAIL_DOMAIN}`, "ITest Admin 3");
    await db.membership.upsert({
      where: { userId_clinicId: { userId: admin.id, clinicId: clinic.id } },
      update: {},
      create: { userId: admin.id, clinicId: clinic.id, role: "CLINIC_ADMIN" },
    });

    await expect(
      db.$transaction(async (tx) =>
        deactivateStaff(tx, { userId: admin.id, clinicId: clinic.id, actorUserId: admin.id }),
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("isolates clinics (mutation requires membership in the target clinic)", async () => {
    const b = await ensureClinic(testClinicB);
    const adminB = await makeUser(`adminb-${suffix}${EMAIL_DOMAIN}`, "ITest Admin B");
    await db.membership.upsert({
      where: { userId_clinicId: { userId: adminB.id, clinicId: b.id } },
      update: {},
      create: { userId: adminB.id, clinicId: b.id, role: "CLINIC_ADMIN" },
    });
    const nurseInA = (await db.user.findUnique({ where: { email: `nurse-${suffix}${EMAIL_DOMAIN}` } }))!;

    await expect(
      db.$transaction(async (tx) =>
        updateStaffRole(tx, {
          userId: nurseInA.id,
          role: "DOCTOR",
          clinicId: b.id,
          actorUserId: adminB.id,
        }),
      ),
    ).rejects.toThrow();
  });

  it("writes audits for sensitive flows", async () => {
    const clinic = await ensureClinic(testClinicA);
    await recordAudit({
      clinicId: clinic.id,
      action: "auth.login.failed",
      entityType: "User",
      entityId: null,
    });
    const rows = await db.auditLog.findMany({
      where: { clinicId: clinic.id, action: "auth.login.failed" },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

afterAll(async () => {
  try {
    const clinicIds = (
      await db.clinic.findMany({ where: { slug: { in: [testClinicA, testClinicB] } }, select: { id: true } })
    ).map((c) => c.id);
    if (clinicIds.length > 0) {
      await db.auditLog.deleteMany({ where: { clinicId: { in: clinicIds } } });
      await db.membership.deleteMany({ where: { clinicId: { in: clinicIds } } });
    }
    const itestUsers = await db.user.findMany({
      where: { email: { endsWith: EMAIL_DOMAIN } },
      select: { id: true },
    });
    for (const u of itestUsers) {
      await db.passwordResetToken.deleteMany({ where: { userId: u.id } });
      await db.emailVerificationToken.deleteMany({ where: { userId: u.id } });
      await db.session.deleteMany({ where: { userId: u.id } });
      await db.membership.deleteMany({ where: { userId: u.id } });
      await db.auditLog.deleteMany({ where: { actorUserId: u.id } });
    }
    await db.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
    await db.clinic.deleteMany({ where: { slug: { in: [testClinicA, testClinicB] } } });
  } catch {
    // cleanup is best-effort; never fail the suite on it
  }
  await db.$disconnect();
});
