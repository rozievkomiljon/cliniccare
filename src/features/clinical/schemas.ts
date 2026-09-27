import { z } from "zod";

/** Strict `YYYY-MM-DDTHH:mm` clinic-local wall clock (minute precision). */
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use YYYY-MM-DDTHH:mm");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? undefined : v))
    .optional();

/** A blank form field means "not measured", never zero. */
function optionalNumber<T extends z.ZodType>(schema: T) {
  return z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());
}

export const ENCOUNTER_KINDS = ["CONSULTATION", "FOLLOW_UP", "PROCEDURE", "TELEHEALTH"] as const;
export const CLINICAL_NOTE_KINDS = ["NOTE", "ADDENDUM", "PROCEDURE"] as const;

export const openEncounterSchema = z.object({
  patientId: z.string().min(1, "Pick a patient."),
  doctorId: z.string().min(1).optional().or(z.literal("")),
  appointmentId: z.string().min(1).optional().or(z.literal("")),
  occurredAt: localDateTime,
  kind: z.enum(ENCOUNTER_KINDS).default("CONSULTATION"),
  chiefComplaint: optionalText(300),
});

export type OpenEncounterInput = z.infer<typeof openEncounterSchema>;

export const updateEncounterSchema = z.object({
  encounterId: z.string().min(1),
  chiefComplaint: optionalText(300),
  diagnosis: optionalText(500),
  plan: optionalText(2000),
});

export type UpdateEncounterInput = z.infer<typeof updateEncounterSchema>;

export const signEncounterSchema = z.object({
  encounterId: z.string().min(1),
});

export type SignEncounterInput = z.infer<typeof signEncounterSchema>;

export const addClinicalNoteSchema = z.object({
  patientId: z.string().min(1),
  encounterId: z.string().min(1).optional().or(z.literal("")),
  kind: z.enum(CLINICAL_NOTE_KINDS).default("NOTE"),
  body: z.string().trim().min(2, "Write the note first.").max(4000),
});

export type AddClinicalNoteInput = z.infer<typeof addClinicalNoteSchema>;

export const recordVitalsSchema = z
  .object({
    patientId: z.string().min(1),
    encounterId: z.string().min(1).optional().or(z.literal("")),
    systolic: optionalNumber(z.coerce.number().int().min(40, "Out of range").max(300, "Out of range")),
    diastolic: optionalNumber(z.coerce.number().int().min(20, "Out of range").max(200, "Out of range")),
    pulse: optionalNumber(z.coerce.number().int().min(20, "Out of range").max(250, "Out of range")),
    temperature: optionalNumber(z.coerce.number().min(25, "Out of range").max(45, "Out of range")),
    spo2: optionalNumber(z.coerce.number().int().min(50, "Out of range").max(100, "Out of range")),
    weightKg: optionalNumber(z.coerce.number().min(0.5, "Out of range").max(500, "Out of range")),
    heightCm: optionalNumber(z.coerce.number().min(20, "Out of range").max(260, "Out of range")),
    notes: optionalText(300),
  })
  .refine(
    (v) => [v.systolic, v.diastolic, v.pulse, v.temperature, v.spo2, v.weightKg, v.heightCm].some((x) => x !== undefined),
    { message: "Record at least one measurement.", path: ["systolic"] },
  )
  .refine((v) => v.systolic === undefined || v.diastolic === undefined || v.systolic > v.diastolic, {
    message: "Systolic must be above diastolic.",
    path: ["systolic"],
  });

export type RecordVitalsInput = z.infer<typeof recordVitalsSchema>;
