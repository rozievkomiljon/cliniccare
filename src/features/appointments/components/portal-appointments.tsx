"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  patientBookAppointmentAction,
  patientCancelAppointmentAction,
  patientRescheduleAppointmentAction,
} from "@/features/appointments/actions";
import type { DoctorListRow } from "@/features/doctors/queries";
import { formatZoned, nextWeekdayLocalInput, toLocalInputValue } from "@/lib/timezone";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type PortalAppointment = {
  id: string;
  doctorName: string;
  scheduledAt: string;
  status: string;
  reason: string | null;
};

/** `YYYY-MM-DD HH:MM (Zone)` — the clinic's wall clock, never the browser's. */
function fmt(iso: string, timeZone: string): string {
  return `${formatZoned(new Date(iso), timeZone)} (${timeZone})`;
}

export function PortalAppointments({
  appointments,
  doctors,
  timeZone,
}: {
  appointments: PortalAppointment[];
  doctors: DoctorListRow[];
  /** Clinic timezone: patients read and type times on the clinic's clock. */
  timeZone: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMessage: string) =>
    startTransition(async () => {
      setError(null);
      setNotice(null);
      const result = await fn();
      if (result.ok) {
        setNotice(okMessage);
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });

  const upcoming = appointments.filter(
    (a) => a.status === "PENDING" || a.status === "CONFIRMED" || a.status === "CHECKED_IN",
  );
  const past = appointments.filter((a) => !upcoming.includes(a));

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <p className="rounded-md border border-teal-600/40 bg-teal-50 px-3 py-2 text-sm text-teal-800 dark:bg-teal-950 dark:text-teal-200">
          {notice}
        </p>
      ) : null}

      <section className="rounded-lg border bg-white p-5 text-sm dark:bg-zinc-900">
        <h2 className="mb-3 font-semibold uppercase tracking-wide text-muted-foreground">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="text-muted-foreground">No upcoming appointments.</p>
        ) : (
          <ul className="space-y-4">
            {upcoming.map((a) => (
              <li key={a.id} className="rounded-md border p-3">
                <p className="font-medium">
                  {fmt(a.scheduledAt, timeZone)} — {a.doctorName}
                </p>
                <p className="text-muted-foreground">
                  {a.status.replaceAll("_", " ").toLowerCase()}
                  {a.reason ? ` · ${a.reason}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      run(
                        () =>
                          patientRescheduleAppointmentAction({
                            appointmentId: a.id,
                            scheduledAt: String(form.get("scheduledAt") ?? ""),
                          }),
                        "Appointment moved.",
                      );
                    }}
                  >
                    <Label htmlFor={`move-${a.id}`} className="block text-xs text-muted-foreground">
                      Move to ({timeZone})
                    </Label>
                    <Input
                      id={`move-${a.id}`}
                      name="scheduledAt"
                      type="datetime-local"
                      required
                      aria-label={`Move appointment of ${fmt(a.scheduledAt, timeZone)}`}
                      defaultValue={toLocalInputValue(new Date(a.scheduledAt), timeZone)}
                      className="mt-1"
                    />
                    <Button className="mt-2" type="submit" variant="outline" size="sm" disabled={pending}>
                      Reschedule
                    </Button>
                  </form>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => patientCancelAppointmentAction({ appointmentId: a.id }), "Appointment cancelled.")}
                  >
                    Cancel
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border bg-white p-5 text-sm dark:bg-zinc-900">
        <h2 className="mb-3 font-semibold uppercase tracking-wide text-muted-foreground">Book a visit</h2>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            run(
              () =>
                patientBookAppointmentAction({
                  doctorId: String(form.get("doctorId") ?? ""),
                  scheduledAt: String(form.get("scheduledAt") ?? ""),
                  reason: String(form.get("reason") ?? ""),
                }),
              "Appointment requested.",
            );
          }}
        >
          <div>
            <Label htmlFor="book-doctor" className="block text-xs text-muted-foreground">
              Doctor
            </Label>
            <select
              id="book-doctor"
              name="doctorId"
              required
              aria-label="Doctor"
              className="mt-1 rounded-md border bg-transparent px-3 py-2 text-sm"
            >
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {d.specialization}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="book-when" className="block text-xs text-muted-foreground">
              When ({timeZone})
            </Label>
            <Input
              id="book-when"
              name="scheduledAt"
              type="datetime-local"
              required
              aria-label="When"
              defaultValue={nextWeekdayLocalInput(timeZone)}
              className="mt-1"
            />
          </div>
          <div className="grow">
            <Label htmlFor="book-reason" className="block text-xs text-muted-foreground">
              Reason
            </Label>
            <Input id="book-reason" name="reason" aria-label="Reason" className="mt-1" />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Requesting…" : "Request appointment"}
          </Button>
        </form>
      </section>

      {past.length > 0 ? (
        <section className="rounded-lg border bg-white p-5 text-sm dark:bg-zinc-900">
          <h2 className="mb-3 font-semibold uppercase tracking-wide text-muted-foreground">History</h2>
          <ul className="space-y-1 text-muted-foreground">
            {past.map((a) => (
              <li key={a.id}>
                {fmt(a.scheduledAt, timeZone)} — {a.doctorName} · {a.status.replaceAll("_", " ").toLowerCase()}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
