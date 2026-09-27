import "server-only";

import { db } from "@/lib/db";

export type DoctorListRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  specialization: string;
  scheduleSummary: string;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmt(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
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
    scheduleSummary:
      d.schedules.length === 0
        ? "No schedule yet"
        : d.schedules
            .map((s) => `${DAY_LABELS[s.weekday]} ${fmt(s.startMinute)}-${fmt(s.endMinute)}`)
            .join(", "),
  }));
}
