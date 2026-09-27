/**
 * Database smoke tests. Skipped automatically when Postgres is unreachable
 * (e.g. a local machine without Docker); forced on in CI where the Postgres
 * service container is guaranteed. Note: this file deliberately avoids
 * importing src/lib/env.ts (server-only) — validation of that module lives in
 * env.test.ts via the shared schema.
 */
import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { envSchema } from "@/lib/env-schema";
import { hasPermission } from "@/lib/rbac/permissions";

async function isDbReachable(): Promise<boolean> {
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const DB_AVAILABLE = await isDbReachable();
const CI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

describe.skipIf(!DB_AVAILABLE && !CI)("database (requires reachable Postgres)", () => {
  it("runs against a valid environment", () => {
    // CI guarantees DATABASE_URL/REDIS_URL (used by the migrate/seed steps);
    // validate exactly those plus NODE_ENV, immune to unrelated runner vars.
    const parsed = envSchema.safeParse({
      DATABASE_URL: process.env.DATABASE_URL,
      REDIS_URL: process.env.REDIS_URL,
      NODE_ENV: process.env.NODE_ENV,
    });
    if (!parsed.success) {
      throw new Error(`CI environment failed schema: ${parsed.error.message}`);
    }
    expect(parsed.success).toBe(true);
  });

  it("counts role users left by the seed (proves migration + seed ran)", async () => {
    const users = await db.user.count();
    expect(users).toBeGreaterThanOrEqual(9);
    const clinic = await db.clinic.findUnique({ where: { slug: "demo-clinic" } });
    expect(clinic).not.toBeNull();
  });

  it("enforces the unique email constraint", async () => {
    await expect(
      db.user.create({
        data: {
          email: "super@cliniccare.local",
          name: "Duplicate",
          passwordHash: "x",
        },
      }),
    ).rejects.toThrow();
  });

  it("scopes memberships per clinic", async () => {
    const memberships = await db.membership.findMany({
      where: { clinic: { slug: "demo-clinic" } },
    });
    expect(memberships.length).toBeGreaterThanOrEqual(9);
    for (const m of memberships) {
      const expected = m.role === "PATIENT" ? "portal:access" : "dashboard:view";
      expect(hasPermission(m.role, expected)).toBe(true);
    }
  });
});
