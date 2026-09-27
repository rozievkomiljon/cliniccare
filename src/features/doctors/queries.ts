import "server-only";

import { db } from "@/lib/db";

export type ScheduleRow = {
  weekday: number;
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
};

export type DoctorListRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  specialization: string;
  schedules: ScheduleRow[];
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatScheduleSummary(schedules: ScheduleRow[]): string {
  if (schedules.length === 0) return "No schedule yet";
  return schedules
    .map((s) => {
      const from = `${String(Math.floor(s.startMinute / 60)).padStart(2, "0")}:${String(s.startMinute % 60).padStart(2, "0")}`;
      const to = `${String(Math.floor(s.endMinute / 60)).padStart(2, "0")}:${String(s.endMinute % 60).padStart(2, "0")}`;
      return `${DAY_LABELS[s.weekday]} ${from}-${to}`;
    })
    .join(", ");
}

/** Clinic-scoped doctor directory for booking forms and schedule admin. */
export async function listDoctors(clinicId: string): Promise<DoctorListRow[]> {
  const rows = await db.doctorProfile.findMany({
    where: { clinicId, isDeleted: false },
    include: {
      user: { select: { name: true, email: true } },
      schedules: { where: { isDeleted: false }, orderBy: { weekday: "asc" } },
    },
    orderBy: { user: { name: "asc" } },
  });

  return rows.map((d) => ({
    id: d.id,
    userId: d.userId,
    name: d.user.name,
    email: d.user.email,
    specialization: d.specialization,
    schedules: d.schedules.map((s) => ({
      weekday: s.weekday,
      startMinute: s.startMinute,
      endMinute: s.endMinute,
      slotMinutes: s.slotMinutes,
    })),
  }));
}
