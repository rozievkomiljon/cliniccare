import { describe, expect, it } from "vitest";

import { CLINIC_SCOPED_ROLES, isClinicScoped } from "@/lib/rbac/roles";
import { hasPermission, PERMISSIONS, ROLE_PERMISSIONS } from "@/lib/rbac/permissions";
import { AppError, ForbiddenError, NotFoundError, UnauthorizedError, toActionError } from "@/lib/errors";

describe("rbac/permissions", () => {
  it("grants every permission to SUPER_ADMIN", () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission("SUPER_ADMIN", permission)).toBe(true);
    }
  });

  it("never grants clinical-adjacent staff the portal permission", () => {
    const staffRoles = [
      "CLINIC_ADMIN",
      "RECEPTIONIST",
      "DOCTOR",
      "NURSE",
      "LAB_TECH",
      "PHARMACIST",
      "ACCOUNTANT",
    ] as const;
    for (const role of staffRoles) {
      expect(hasPermission(role, "portal:access")).toBe(false);
    }
  });

  it("gives PATIENT only the portal permission", () => {
    expect(ROLE_PERMISSIONS.PATIENT).toEqual(["portal:access"]);
  });

  it("gives every role a non-empty permission set", () => {
    for (const role of Object.keys(ROLE_PERMISSIONS) as Array<keyof typeof ROLE_PERMISSIONS>) {
      const granted = ROLE_PERMISSIONS[role];
      expect(granted).toBeDefined();
      if (granted) expect(granted.length).toBeGreaterThan(0);
    }
  });
});

describe("rbac/roles", () => {
  it("classifies only SUPER_ADMIN as not clinic-scoped", () => {
    expect(isClinicScoped("SUPER_ADMIN")).toBe(false);
    for (const role of CLINIC_SCOPED_ROLES) {
      expect(isClinicScoped(role)).toBe(true);
    }
  });
});

describe("errors", () => {
  it("maps AppError to its own message and code", () => {
    const result = toActionError(new NotFoundError("Patient not found"));
    expect(result).toEqual({ ok: false, error: "Patient not found", code: "NOT_FOUND" });
  });

  it("maps unexpected errors to a generic message without internals", () => {
    const result = toActionError(new Error("connection string postgres://secret"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Something went wrong. Please try again.");
      expect(result.error).not.toContain("postgres://");
      expect(result.code).toBe("INTERNAL");
    }
  });

  it("assigns distinct status codes per error type", () => {
    expect(new UnauthorizedError().status).toBe(401);
    expect(new ForbiddenError().status).toBe(403);
    expect(new NotFoundError().status).toBe(404);
    expect(new AppError("x").status).toBe(400);
  });
});
