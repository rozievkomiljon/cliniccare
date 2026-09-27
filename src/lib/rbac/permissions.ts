/**
 * RBAC vocabulary. Phase 0 ships a minimal starter set to establish the
 * pattern; Phase 1 replaces it with the full per-module permission map from
 * the approved plan. Permissions are compile-time typed strings.
 */
import type { Role } from "@prisma/client";

export const PERMISSIONS = [
  "dashboard:view",
  "patients:view",
  "clinic:admin",
  "portal:access",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = [...PERMISSIONS];

/**
 * Ordered by privilege. Tests assert SUPER_ADMIN ⊇ CLINIC_ADMIN and that
 * PATIENT receives only portal-scoped permissions.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: ALL,
  CLINIC_ADMIN: ALL.filter((p) => p !== "portal:access"),
  RECEPTIONIST: ["dashboard:view", "patients:view"],
  DOCTOR: ["dashboard:view", "patients:view"],
  NURSE: ["dashboard:view", "patients:view"],
  LAB_TECH: ["dashboard:view"],
  PHARMACIST: ["dashboard:view"],
  ACCOUNTANT: ["dashboard:view"],
  PATIENT: ["portal:access"],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  const granted = ROLE_PERMISSIONS[role];
  if (!granted) return false;
  return granted.includes(permission);
}
