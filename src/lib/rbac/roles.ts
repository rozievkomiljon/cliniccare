import type { Role } from "@prisma/client";

/** Roles that are scoped to a clinic via Membership (everything but Super Admin). */
export const CLINIC_SCOPED_ROLES: readonly Role[] = [
  "CLINIC_ADMIN",
  "RECEPTIONIST",
  "DOCTOR",
  "NURSE",
  "LAB_TECH",
  "PHARMACIST",
  "ACCOUNTANT",
  "PATIENT",
];

export function isClinicScoped(role: Role): boolean {
  return role !== "SUPER_ADMIN";
}
