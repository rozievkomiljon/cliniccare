/**
 * Pure day-slot builder for the calendar timeline: turns one doctor's weekly
 * schedule plus a day of appointments into a list of bookable slots. Kept free
 * of Prisma/DB types so it is unit-testable and safe to share with clients.
 */
import { zonedTimeToInstant } from "@/lib/timezone";

export type ScheduleWindow = {
  weekday: number;
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
};

export type SlotAppointment = {
  id: string;
  /** ISO instant. */
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  patientName: string;
  patientMrn?: string;
  doctorName?: string;
  doctorId?: string;
};

export type DaySlot = {
  /** `HH:MM` clinic-local label. */
  label: string;
  startMinute: number;
  start: Date;
  end: Date;
  appointment?: SlotAppointment;
};

export type DayTimeline = {
  slots: DaySlot[];
  /** Appointments that do not line up with any schedule slot (overbooked, odd times). */
  outsideSchedule: SlotAppointment[];
};

function label(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** True when [aStart, aEnd) overlaps [bStart, bEnd). */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function buildDayTimeline(input: {
  date: string; // YYYY-MM-DD, clinic-local
  timeZone: string;
  schedule: ScheduleWindow | null;
  appointments: SlotAppointment[];
}): DayTimeline {
  const schedule = input.schedule;
  if (!schedule) {
    return { slots: [], outsideSchedule: [...input.appointments] };
  }

  const slotMs = schedule.slotMinutes * 60_000;
  const slots: DaySlot[] = [];
  const claimed = new Set<string>();

  for (let minute = schedule.startMinute; minute + schedule.slotMinutes <= schedule.endMinute; minute += schedule.slotMinutes) {
    const start = zonedTimeToInstant(
      { ...splitDate(input.date), hour: Math.floor(minute / 60), minute: minute % 60 },
      input.timeZone,
    );
    const end = new Date(start.getTime() + slotMs);
    const startMs = start.getTime();
    const endMs = end.getTime();

    const appointment = input.appointments.find((a) => {
      const aStart = new Date(a.scheduledAt).getTime();
      const aEnd = aStart + a.durationMinutes * 60_000;
      return overlaps(aStart, aEnd, startMs, endMs);
    });

    if (appointment) claimed.add(appointment.id);
    slots.push({ label: label(minute), startMinute: minute, start, end, appointment });
  }

  return {
    slots,
    outsideSchedule: input.appointments.filter((a) => !claimed.has(a.id)),
  };
}

function splitDate(date: string): { year: number; month: number; day: number } {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return { year, month, day };
}
