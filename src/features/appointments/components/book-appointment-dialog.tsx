"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createAppointmentAction } from "@/features/appointments/actions";
import type { DoctorListRow } from "@/features/doctors/queries";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Patient options for the picker (light registry slice). */
export type PatientOption = { id: string; mrn: string; firstName: string; lastName: string };

/** Default the picker to a weekday mid-morning slot within the doctor's hours. */
function defaultSlotIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(10, 0, 0, 0);
  return d.toISOString().slice(0, 16);
}

export function BookAppointmentForm({
  doctors,
  patients,
}: {
  doctors: DoctorListRow[];
  patients: PatientOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Book appointment</Button>;
  }

  return (
    <form
      className="w-full max-w-xl rounded-xl border bg-white p-6 shadow-sm dark:bg-zinc-900"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await createAppointmentAction({
            doctorId: String(form.get("doctorId") ?? ""),
            patientId: String(form.get("patientId") ?? ""),
            scheduledAt: String(form.get("scheduledAt") ?? ""),
            durationMinutes: Number(form.get("durationMinutes") ?? 30),
            reason: String(form.get("reason") ?? ""),
          });
          if (result.ok) {
            setOpen(false);
            router.refresh();
          } else {
            setError(result.error);
          }
        });
      }}
    >
      <h2 className="text-lg font-semibold">Book appointment</h2>
      {error ? (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="doctorId" className="block text-sm font-medium">
            Doctor<span className="text-red-600"> *</span>
          </Label>
          <select
            id="doctorId"
            name="doctorId"
            required
            aria-label="Doctor"
            className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
          >
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} — {d.specialization}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="patientId" className="block text-sm font-medium">
            Patient<span className="text-red-600"> *</span>
          </Label>
          <select
            id="patientId"
            name="patientId"
            required
            aria-label="Patient"
            className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
          >
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.mrn} — {p.lastName}, {p.firstName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="scheduledAt" className="block text-sm font-medium">
            Date &amp; time (UTC)<span className="text-red-600"> *</span>
          </Label>
          <Input
            id="scheduledAt"
            name="scheduledAt"
            type="datetime-local"
            required
            aria-label="Date and time"
            defaultValue={defaultSlotIso()}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="durationMinutes" className="block text-sm font-medium">
            Duration (minutes)
          </Label>
          <Input
            id="durationMinutes"
            name="durationMinutes"
            type="number"
            min={5}
            max={480}
            step={5}
            defaultValue={30}
            aria-label="Duration minutes"
            className="mt-1"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="reason" className="block text-sm font-medium">
            Reason
          </Label>
          <Input id="reason" name="reason" aria-label="Reason" placeholder="Follow-up, first visit…" className="mt-1" />
        </div>
      </div>

      <div className="mt-6 flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Booking…" : "Book"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
