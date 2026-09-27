"use client";

import Link from "next/link";
import { useState } from "react";

import {
  BookAppointmentForm,
  type PatientOption,
} from "@/features/appointments/components/book-appointment-dialog";

export type DaySlotAppointmentView = {
  id: string;
  patientName: string;
  patientMrn: string;
  durationMinutes: number;
  status: string;
  reason: string | null;
};

export type DaySlotView = {
  label: string;
  /** ISO instant of the slot start. */
  startIso: string;
  endIso: string;
  appointment: DaySlotAppointmentView | null;
};

const STATUS_TONE: Record<string, string> = {
  PENDING: "border-amber-500/50 bg-amber-50 dark:bg-amber-950/40",
  CONFIRMED: "border-teal-600/50 bg-teal-50 dark:bg-teal-950/40",
  CHECKED_IN: "border-sky-600/50 bg-sky-50 dark:bg-sky-950/40",
  IN_PROGRESS: "border-indigo-600/50 bg-indigo-50 dark:bg-indigo-950/40",
};

function statusLabel(status: string): string {
  return status.replaceAll("_", " ").toLowerCase();
}

/**
 * One doctor's day as a grid of schedule slots. Free slots are clickable and
 * prefill the booking form with that exact time; booked slots link to the
 * appointment. Appointments that fall outside the shift are listed separately
 * so an overbooked slot is never invisible.
 */
export function DaySlotGrid({
  date,
  timeZone,
  doctor,
  slots,
  outsideSchedule,
  patients,
  canManage,
}: {
  date: string;
  timeZone: string;
  doctor: { id: string; name: string; specialization: string } | null;
  slots: DaySlotView[];
  outsideSchedule: DaySlotAppointmentView[];
  patients: PatientOption[];
  canManage: boolean;
}) {
  const [selected, setSelected] = useState<DaySlotView | null>(null);

  if (!doctor) {
    return (
      <p className="rounded-lg border bg-white p-6 text-sm text-muted-foreground dark:bg-zinc-900">
        Pick a doctor to see their slot grid for {date}.
      </p>
    );
  }

  const free = slots.filter((s) => !s.appointment).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {doctor.name} · {doctor.specialization} · {free} free of {slots.length} slot(s) on {date} ({timeZone})
      </p>

      {slots.length === 0 ? (
        <p className="rounded-lg border bg-white p-6 text-sm text-muted-foreground dark:bg-zinc-900">
          No working hours on this day. Add a schedule row for this weekday to open slots.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {slots.map((slot) => {
            const appointment = slot.appointment;
            return (
              <li key={slot.startIso}>
                {appointment ? (
                  <div
                    className={`rounded-lg border p-3 text-sm ${STATUS_TONE[appointment.status] ?? "bg-muted/40"}`}
                    data-testid={`slot-${slot.label}`}
                  >
                    <p className="font-medium">
                      {slot.label} · {appointment.patientName}
                    </p>
                    <p className="text-muted-foreground">
                      {appointment.durationMinutes} min · {statusLabel(appointment.status)}
                      {appointment.reason ? ` · ${appointment.reason}` : ""}
                    </p>
                    <Link href={`/appointments/${appointment.id}`} className="text-teal-700 hover:underline dark:text-teal-400">
                      details
                    </Link>
                  </div>
                ) : canManage ? (
                  <button
                    type="button"
                    data-testid={`slot-${slot.label}`}
                    onClick={() => setSelected(selected?.startIso === slot.startIso ? null : slot)}
                    className={`w-full rounded-lg border border-dashed p-3 text-left text-sm hover:bg-muted/50 ${
                      selected?.startIso === slot.startIso ? "border-teal-600 bg-teal-50 dark:bg-teal-950/40" : ""
                    }`}
                  >
                    <span className="font-medium">{slot.label}</span>
                    <span className="text-muted-foreground"> · free — book</span>
                  </button>
                ) : (
                  <div className="rounded-lg border border-dashed p-3 text-sm" data-testid={`slot-${slot.label}`}>
                    <span className="font-medium">{slot.label}</span>
                    <span className="text-muted-foreground"> · free</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {selected && canManage ? (
        // `key` remounts the form so switching slots replaces its prefilled value.
        <BookAppointmentForm
          key={selected.startIso}
          doctors={[doctor]}
          patients={patients}
          timeZone={timeZone}
          defaultDoctorId={doctor.id}
          defaultScheduledAt={selected.startIso}
          startOpen
        />
      ) : null}

      {outsideSchedule.length > 0 ? (
        <section className="rounded-lg border bg-white p-4 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Outside working hours
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {outsideSchedule.map((a) => (
              <li key={a.id}>
                <Link href={`/appointments/${a.id}`} className="text-teal-700 hover:underline dark:text-teal-400">
                  {a.patientName}
                </Link>{" "}
                <span className="text-muted-foreground">
                  · {a.durationMinutes} min · {statusLabel(a.status)}
                  {a.reason ? ` · ${a.reason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
