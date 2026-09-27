import { z } from "zod";

/** Strict ISO date input from forms; normalized in the service. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => (v.trim() === "" ? undefined : v.trim()))
    .optional()
    .or(z.literal(""));

export const SEXES = ["MALE", "FEMALE", "OTHER"] as const;
export const BLOOD_GROUPS = [
  "A_POSITIVE",
  "A_NEGATIVE",
  "B_POSITIVE",
  "B_NEGATIVE",
  "AB_POSITIVE",
  "AB_NEGATIVE",
  "O_POSITIVE",
  "O_NEGATIVE",
  "UNKNOWN",
] as const;

export const createPatientSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(80),
  lastName: z.string().trim().min(1, "Last name is required.").max(80),
  dateOfBirth: isoDate,
  sex: z.enum(SEXES),
  phone: z
    .string()
    .trim()
    .regex(/^[+0-9 ()-]{5,25}$/, "Enter a valid phone number."),
  email: z.string().email("Enter a valid email.").max(255).optional().or(z.literal("")),
  address: optionalText(200),
  city: optionalText(80),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: z
    .string()
    .trim()
    .regex(/^[+0-9 ()-]{5,25}$/, "Enter a valid phone number.")
    .optional()
    .or(z.literal("")),
  bloodGroup: z.enum(BLOOD_GROUPS).optional(),
  allergies: optionalText(500),
  chronicConditions: optionalText(500),
  notes: optionalText(1000),
});

export type CreatePatientInput = z.infer<typeof createPatientSchema>;

export const updatePatientSchema = createPatientSchema.partial().extend({
  patientId: z.string().min(1),
});

export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;

export const listPatientsSchema = z.object({
  query: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const deleteAttachmentSchema = z.object({
  attachmentId: z.string().min(1),
});

export const updateAttachmentDescriptionSchema = z.object({
  attachmentId: z.string().min(1),
  description: z.string().trim().max(200),
});
