import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? undefined : v))
    .optional();

/** A blank form field means "not reported", never zero. */
function optionalNumber<T extends z.ZodType>(schema: T) {
  return z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());
}

export const LAB_SPECIMEN_TYPES = ["BLOOD", "URINE", "STOOL", "SWAB", "TISSUE", "OTHER"] as const;
export const LAB_PRIORITIES = ["ROUTINE", "URGENT", "STAT"] as const;
export const LAB_RESULT_FLAGS = ["NORMAL", "LOW", "HIGH", "CRITICAL"] as const;

/** `LAB-` style code; uppercased so the per-clinic uniqueness is predictable. */
const testCode = z
  .string()
  .trim()
  .min(1, "Enter a code.")
  .max(20)
  .transform((v) => v.toUpperCase());

export const upsertLabTestSchema = z.object({
  /** Absent/empty creates a new catalog entry; otherwise it edits that one. */
  testId: z.string().min(1).optional().or(z.literal("")),
  code: testCode,
  name: z.string().trim().min(2, "Enter a test name.").max(120),
  category: z.string().trim().min(1).max(60).default("GENERAL"),
  specimen: z.enum(LAB_SPECIMEN_TYPES).default("BLOOD"),
  unit: optionalText(30),
  referenceRange: optionalText(120),
  turnaroundHours: optionalNumber(z.coerce.number().int().min(1, "Out of range").max(720, "Out of range")),
  isActive: z.boolean().default(true),
});

export type UpsertLabTestInput = z.infer<typeof upsertLabTestSchema>;

export const deactivateLabTestSchema = z.object({ testId: z.string().min(1) });

export type DeactivateLabTestInput = z.infer<typeof deactivateLabTestSchema>;

export const placeLabOrderSchema = z.object({
  patientId: z.string().min(1, "Pick a patient."),
  doctorId: z.string().min(1).optional().or(z.literal("")),
  encounterId: z.string().min(1).optional().or(z.literal("")),
  priority: z.enum(LAB_PRIORITIES).default("ROUTINE"),
  indication: optionalText(500),
  testIds: z
    .array(z.string().min(1))
    .min(1, "Pick at least one test.")
    .max(20, "Too many tests in one order."),
});

export type PlaceLabOrderInput = z.infer<typeof placeLabOrderSchema>;

export const collectLabOrderSchema = z.object({ orderId: z.string().min(1) });

export type CollectLabOrderInput = z.infer<typeof collectLabOrderSchema>;

const optionalFlag = z.enum(LAB_RESULT_FLAGS).optional().or(z.literal(""));

export const enterLabResultsSchema = z.object({
  orderId: z.string().min(1),
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        resultValue: z.string().trim().min(1, "Enter a result.").max(200),
        flag: optionalFlag,
        comment: optionalText(300),
      }),
    )
    .min(1, "Enter at least one result.")
    .max(20),
});

export type EnterLabResultsInput = z.infer<typeof enterLabResultsSchema>;

export const verifyLabOrderSchema = z.object({ orderId: z.string().min(1) });

export type VerifyLabOrderInput = z.infer<typeof verifyLabOrderSchema>;

export const cancelLabOrderSchema = z.object({ orderId: z.string().min(1) });

export type CancelLabOrderInput = z.infer<typeof cancelLabOrderSchema>;
