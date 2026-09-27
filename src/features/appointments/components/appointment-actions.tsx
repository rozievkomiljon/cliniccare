"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  cancelAppointmentAction,
  rescheduleAppointmentAction,
  setAppointmentStatusAction,
} from "@/features/appointments/actions";
import { toLocalInputValue } from "@/lib/timezone";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AppointmentActionsProps = {
  appointment: {
    id: string;
    status: string;
    scheduledAt: string;
    durationMinutes: number;
  };
};

/** Next legal staff transitions per status. */
const NEXT_STATUS: Record<string, Array<{ value: string; label: string }>> = {
  PENDING: [{ value: "CONFIRMED", label: "Confirm" }],
  CONFIRMED: [
    { value: "CHECKED_IN", label: "Check in" },
    { value: "NO_SHOW", label: "Mark no-show" },
  ],
  CHECKED_IN: [{ value: "IN_PROGRESS", label: "Start visit" }],
  IN_PROGRESS: [{ value: "COMPLETED", label: "Complete" }],
};

export function AppointmentActions({ appointment, timeZone }: AppointmentActionsProps & { timeZone: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const active = appointment.status === "PENDING" || appointment.status === "CONFIRMED";

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });

  const next = NEXT_STATUS[appointment.status] ?? [];

  return (
    <section className="rounded-lg border bg-white p-5 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Actions
      </h2>
      {error ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {next.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {next.map((s) => (
            <Button
              key={s.value}
              size="sm"
              disabled={pending}
              onClick={() => run(() => setAppointmentStatusAction({ appointmentId: appointment.id, status: s.value as never }))}
            >
              {s.label}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">This appointment is final; no further actions.</p>
      )}

      {active ? (
        <form
          className="mt-4 space-y-3 border-t pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            run(() =>
              rescheduleAppointmentAction({
                appointmentId: appointment.id,
                scheduledAt: String(form.get("scheduledAt") ?? ""),
              }),
            );
          }}
        >
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="scheduledAt" className="block text-xs text-muted-foreground">
                Move to ({timeZone})
              </Label>
              <Input
                id="scheduledAt"
                name="scheduledAt"
                type="datetime-local"
                required
                aria-label="Move to date and time"
                defaultValue={toLocalInputValue(new Date(appointment.scheduledAt), timeZone)}
                className="mt-1"
              />
            </div>
            <Button type="submit" variant="outline" size="sm" disabled={pending}>
              Reschedule
            </Button>
          </div>
        </form>
      ) : null}

      {active ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 border-t pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            run(() =>
              cancelAppointmentAction({
                appointmentId: appointment.id,
                reason: String(form.get("reason") ?? ""),
              }),
            );
          }}
        >
          <div className="grow">
            <Label htmlFor="reason" className="block text-xs text-muted-foreground">
              Cancellation reason
            </Label>
            <Input id="reason" name="reason" aria-label="Cancellation reason" className="mt-1" />
          </div>
          <Button type="submit" variant="destructive" size="sm" disabled={pending}>
            Cancel appointment
          </Button>
        </form>
      ) : null}
    </section>
  );
}
