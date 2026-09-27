import { z } from "zod";

/** Strict `YYYY-MM-DDTHH:mm` (minute precision, no seconds). */
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use YYYY-MM-DDTHH:mm");

export const APPOINTMENT_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const;

export const createAppointmentSchema = z.object({
  doctorId: z.string().min(1, "Pick a doctor."),
  patientId: z.string().min(1, "Pick a patient."),
  scheduledAt: localDateTime,
  durationMinutes: z.coerce.number().int().min(5).max(480).default(30),
  reason: z
    .string()
    .trim()
    .max(300)
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

export const rescheduleAppointmentSchema = z.object({
  appointmentId: z.string().min(1),
  scheduledAt: localDateTime,
  durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
});

export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;

export const cancelAppointmentSchema = z.object({
  appointmentId: z.string().min(1),
  reason: z
    .string()
    .trim()
    .max(300)
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
});

export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;

/** Staff-only lifecycle transitions (checked in / in progress / completed / no-show). */
export const appointmentStatusActionSchema = z.object({
  appointmentId: z.string().min(1),
  status: z.enum(["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW"]),
});

export type AppointmentStatusActionInput = z.infer<typeof appointmentStatusActionSchema>;
