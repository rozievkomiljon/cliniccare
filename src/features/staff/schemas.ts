import { z } from "zod";

const STAFF_ROLES = [
  "CLINIC_ADMIN",
  "RECEPTIONIST",
  "DOCTOR",
  "NURSE",
  "LAB_TECH",
  "PHARMACIST",
  "ACCOUNTANT",
] as const;

export const createStaffSchema = z.object({
  name: z.string().min(2, "Name is too short.").max(120),
  email: z.string().email("Enter a valid email.").max(255),
  role: z.enum(STAFF_ROLES),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateStaffRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(STAFF_ROLES),
});

export const deactivateStaffSchema = z.object({
  userId: z.string().min(1),
});
