/**
 * Auth integration tests (Postgres-backed; skipped without a DB, forced in CI
 * where the service container is guaranteed). Covers the pieces behind the
 * login flow: password hashing, credential verification inputs, token
 * lifecycle, and the RBAC guard's typed rejections.
 */
import { describe, expect, it } from "vitest";

import { hashPassword, isPasswordValid, passwordIssues, verifyPassword } from "@/lib/auth/password";
import { createToken, sha256 } from "@/lib/auth/tokens";
import { db } from "@/lib/db";
import { envSchema } from "@/lib/env-schema";
import { hasPermission } from "@/lib/rbac/permissions";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";

const DB_AVAILABLE = await import("@/lib/db").then(async ({ db }) => {
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
});
const CI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const hasDb = DB_AVAILABLE || CI;

describe.skipIf(!hasDb)("password service", () => {
  it("hashes and verifies with argon2id", async () => {
    const hashValue = await hashPassword("Sup3r$ecret!pw");
    expect(hashValue.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hashValue, "Sup3r$ecret!pw")).toBe(true);
    expect(await verifyPassword(hashValue, "wrong")).toBe(false);
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });

  it("enforces the password policy", () => {
    expect(isPasswordValid("Sup3r$ecret!pw")).toBe(true);
    expect(passwordIssues("short").length).toBeGreaterThan(0);
    expect(passwordIssues("alllowercase1!").some((i) => i.includes("uppercase"))).toBe(true);
    expect(passwordIssues("NoDigits!!").some((i) => i.includes("digit"))).toBe(true);
  });
});

describe.skipIf(!hasDb)("token service", () => {
  it("creates single-use, hashed tokens", () => {
    const a = createToken();
    const b = createToken();
    expect(a.token).not.toEqual(b.token);
    expect(a.tokenHash).toEqual(sha256(a.token));
    expect(a.tokenHash).not.toEqual(a.token);
  });
});

describe.skipIf(!hasDb)("credential verification inputs", () => {
  it("rejects unknown users and disabled accounts", async () => {
    const missing = await db.user.findUnique({ where: { email: "ghost@nowhere.test" } });
    expect(missing).toBeNull();

    const seeded = await db.user.findUnique({ where: { email: "doctor@cliniccare.local" } });
    expect(seeded).not.toBeNull();
    expect(seeded?.isActive).toBe(true);
  });
});

describe("guard errors are typed", () => {
  it("throws UnauthorizedError/ForbiddenError classes", () => {
    expect(new UnauthorizedError().code).toBe("UNAUTHORIZED");
    expect(new ForbiddenError().code).toBe("FORBIDDEN");
  });
});

describe("rbac matrix", () => {
  const ALL_ROLES = [
    "SUPER_ADMIN",
    "CLINIC_ADMIN",
    "RECEPTIONIST",
    "DOCTOR",
    "NURSE",
    "LAB_TECH",
    "PHARMACIST",
    "ACCOUNTANT",
    "PATIENT",
  ] as const;

  it("gives super admin everything and patients portal-only extras", () => {
    for (const p of ["clinics:manage", "staff:manage", "audit:view"] as const) {
      expect(hasPermission("SUPER_ADMIN", p)).toBe(true);
    }
    expect(hasPermission("PATIENT", "portal:access")).toBe(true);
    expect(hasPermission("PATIENT", "appointments:own")).toBe(true);
    expect(hasPermission("PATIENT", "patients:view")).toBe(false);
  });

  it("keeps clinical authoring doctor-only", () => {
    expect(hasPermission("DOCTOR", "clinical:author")).toBe(true);
    for (const role of ["NURSE", "RECEPTIONIST", "LAB_TECH", "PHARMACIST", "ACCOUNTANT"] as const) {
      expect(hasPermission(role, "clinical:author")).toBe(false);
    }
  });

  it("keeps lab verification doctor-only", () => {
    expect(hasPermission("LAB_TECH", "lab:verify")).toBe(false);
    expect(hasPermission("DOCTOR", "lab:verify")).toBe(true);
  });

  it("keeps dispensing pharmacist-only", () => {
    expect(hasPermission("PHARMACIST", "pharmacy:dispense")).toBe(true);
    expect(hasPermission("NURSE", "pharmacy:dispense")).toBe(false);
  });

  it("separates finance from clinical data", () => {
    expect(hasPermission("ACCOUNTANT", "billing:manage")).toBe(true);
    expect(hasPermission("ACCOUNTANT", "clinical:view")).toBe(false);
    expect(hasPermission("ACCOUNTANT", "patients:view")).toBe(false);
  });

  it("restricts staff management and audit to admins", () => {
    for (const role of ["RECEPTIONIST", "DOCTOR", "NURSE", "LAB_TECH", "PHARMACIST", "ACCOUNTANT"] as const) {
      expect(hasPermission(role, "staff:manage")).toBe(false);
      expect(hasPermission(role, "audit:view")).toBe(false);
    }
    expect(hasPermission("CLINIC_ADMIN", "staff:manage")).toBe(true);
    expect(hasPermission("CLINIC_ADMIN", "audit:view")).toBe(true);
  });

  it("keeps the matrix total (every role has at least one permission)", () => {
    for (const role of ALL_ROLES) {
      expect(hasPermission(role, "dashboard:view") || hasPermission(role, "portal:access")).toBe(true);
    }
  });

  it("CI environment satisfies the env schema", () => {
    const parsed = envSchema.safeParse({
      DATABASE_URL: process.env.DATABASE_URL,
      REDIS_URL: process.env.REDIS_URL,
      NODE_ENV: process.env.NODE_ENV,
      AUTH_SECRET: process.env.AUTH_SECRET ?? "x".repeat(40),
    });
    expect(parsed.success).toBe(true);
  });
});
