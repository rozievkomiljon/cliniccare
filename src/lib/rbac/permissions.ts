/**
 * RBAC vocabulary — the compile-time typed permission list and the per-role
 * grant map from the approved RBAC matrix. Server Components, actions, and
 * route handlers all authorize through hasPermission/requirePermission.
 * UI visibility is cosmetic; this file plus row scoping is the boundary.
 */
import type { Role } from "@prisma/client";

export const PERMISSIONS = [
  // clinics & staff
  "clinics:manage",
  "staff:manage",
  "settings:manage",
  // patients
  "patients:view",
  "patients:manage",
  // clinical
  "clinical:view",
  "clinical:author",
  "vitals:record",
  // doctors & scheduling
  "schedule:manage",
  "schedule:view",
  "appointments:manage",
  "appointments:own",
  // laboratory
  "lab:catalog",
  "lab:order",
  "lab:collect",
  "lab:verify",
  // pharmacy
  "pharmacy:catalog",
  "pharmacy:dispense",
  // billing
  "billing:manage",
  "billing:view",
  // dashboards, reports, audit, portal
  "dashboard:view",
  "reports:view",
  "audit:view",
  "portal:access",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const STAFF_DASHBOARD: Permission[] = ["dashboard:view"];

/** The approved RBAC matrix, encoded. Keep in sync with tests/rbac.test.ts. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: [...PERMISSIONS],
  CLINIC_ADMIN: [
    "staff:manage",
    "settings:manage",
    "patients:view",
    "patients:manage",
    "schedule:manage",
    "schedule:view",
    "appointments:manage",
    "billing:manage",
    "billing:view",
    "dashboard:view",
    "reports:view",
    "audit:view",
  ],
  RECEPTIONIST: [
    ...STAFF_DASHBOARD,
    "patients:view",
    "patients:manage",
    "schedule:view",
    "appointments:manage",
    "billing:manage",
    "billing:view",
  ],
  DOCTOR: [
    ...STAFF_DASHBOARD,
    "patients:view",
    "clinical:view",
    "clinical:author",
    "vitals:record",
    "schedule:view",
    "appointments:own",
    "lab:order",
    "lab:verify",
  ],
  NURSE: [
    ...STAFF_DASHBOARD,
    "patients:view",
    "clinical:view",
    "vitals:record",
    "schedule:view",
    "appointments:manage",
    "lab:order",
  ],
  LAB_TECH: [...STAFF_DASHBOARD, "lab:catalog", "lab:collect"],
  PHARMACIST: [...STAFF_DASHBOARD, "pharmacy:catalog", "pharmacy:dispense"],
  ACCOUNTANT: [...STAFF_DASHBOARD, "billing:manage", "billing:view", "reports:view"],
  PATIENT: ["portal:access", "appointments:own"],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  const granted = ROLE_PERMISSIONS[role];
  if (!granted) return false;
  return granted.includes(permission);
}
