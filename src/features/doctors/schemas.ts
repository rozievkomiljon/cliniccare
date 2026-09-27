import { z } from "zod";

/** Weekly schedule is stored as minutes-from-midnight (UTC) per weekday. */
const minutes = z.number().int().min(0, "Out of range").max(1440, "Out of range");

export const scheduleRowSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startMinute: minutes,
    endMinute: minutes,
    slotMinutes: z.number().int().min(5).max(240),
  })
  .refine((row) => row.startMinute < row.endMinute, {
    message: "End of day must be after the start.",
  });

export const upsertDoctorProfileSchema = z.object({
  userId: z.string().min(1, "Pick a staff member."),
  specialization: z.string().trim().min(2, "Specialization is required.").max(120),
  bio: z
    .string()
    .trim()
    .max(1000)
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
  licenseNo: z
    .string()
    .trim()
    .max(60)
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
});

export type UpsertDoctorProfileInput = z.infer<typeof upsertDoctorProfileSchema>;

export const upsertDoctorScheduleSchema = z
  .object({
    doctorId: z.string().min(1),
    rows: z.array(scheduleRowSchema).max(7),
  })
  .refine(
    (input) => {
      const weekdays = input.rows.map((r) => r.weekday);
      return new Set(weekdays).size === weekdays.length;
    },
    { message: "Only one schedule per weekday." },
  );

export type UpsertDoctorScheduleInput = z.infer<typeof upsertDoctorScheduleSchema>;
