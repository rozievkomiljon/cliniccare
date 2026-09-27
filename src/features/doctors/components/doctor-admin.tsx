"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  addDoctorTimeOffAction,
  removeDoctorTimeOffAction,
  upsertDoctorProfileAction,
} from "@/features/doctors/actions";
import type { TimeOffRow } from "@/features/doctors/queries";
import { formatZoned } from "@/lib/timezone";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type DoctorCandidate = { userId: string; name: string; email: string };

const labelCls = "block text-sm font-medium";
const inputCls = "mt-1 w-full";

/** Creates the doctor profile for an existing DOCTOR-role staff member. */
export function AddDoctorForm({ candidates }: { candidates: DoctorCandidate[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} disabled={candidates.length === 0}>
        Add doctor profile
      </Button>
    );
  }

  return (
    <form
      className="w-full max-w-xl rounded-xl border bg-white p-6 shadow-sm dark:bg-zinc-900"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await upsertDoctorProfileAction({
            userId: String(form.get("userId") ?? ""),
            specialization: String(form.get("specialization") ?? ""),
            licenseNo: String(form.get("licenseNo") ?? ""),
            bio: String(form.get("bio") ?? ""),
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
      <h2 className="text-lg font-semibold">Add doctor profile</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Doctor profiles attach a specialization and schedule to an existing doctor-role staff member.
      </p>
      {error ? (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-4 space-y-4">
        <div>
          <Label htmlFor="userId" className={labelCls}>
            Staff member<span className="text-red-600"> *</span>
          </Label>
          <select
            id="userId"
            name="userId"
            required
            aria-label="Staff member"
            className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
          >
            {candidates.map((c) => (
              <option key={c.userId} value={c.userId}>
                {c.name} — {c.email}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="specialization" className={labelCls}>
            Specialization<span className="text-red-600"> *</span>
          </Label>
          <Input id="specialization" name="specialization" required aria-label="Specialization" className={inputCls} placeholder="Cardiology" />
        </div>
        <div>
          <Label htmlFor="licenseNo" className={labelCls}>
            License number
          </Label>
          <Input id="licenseNo" name="licenseNo" aria-label="License number" className={inputCls} />
        </div>
        <div>
          <Label htmlFor="bio" className={labelCls}>
            Bio
          </Label>
          <Input id="bio" name="bio" aria-label="Bio" className={inputCls} />
        </div>
      </div>

      <div className="mt-6 flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Time-off list + entry form: absences immediately block new bookings. */
export function TimeOffEditor({
  doctorId,
  doctorName,
  timeZone,
  timeOff,
}: {
  doctorId: string;
  doctorName: string;
  timeZone: string;
  timeOff: TimeOffRow[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [fullDay, setFullDay] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (result.ok) router.refresh();
      else setError(result.error ?? "Something went wrong.");
    });

  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      <p className="text-sm font-medium">
        Time off — {doctorName} <span className="font-normal text-muted-foreground">({timeZone})</span>
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {timeOff.length === 0 ? (
        <p className="text-sm text-muted-foreground">No upcoming absences.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {timeOff.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2">
              <span>
                {t.isFullDay ? `${t.startsAt.slice(0, 10)} (all day)` : `${formatZoned(new Date(t.startsAt), timeZone)} → ${formatZoned(new Date(t.endsAt), timeZone)}`}
                {t.reason ? ` · ${t.reason}` : ""}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                aria-label={`Remove absence on ${t.startsAt.slice(0, 10)}`}
                onClick={() => run(() => removeDoctorTimeOffAction({ timeOffId: t.id }))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          run(() =>
            addDoctorTimeOffAction({
              doctorId,
              date: String(form.get("date") ?? ""),
              isFullDay: fullDay,
              startTime: fullDay ? "" : String(form.get("startTime") ?? ""),
              endTime: fullDay ? "" : String(form.get("endTime") ?? ""),
              reason: String(form.get("reason") ?? ""),
            }),
          );
        }}
      >
        <div>
          <Label htmlFor={`date-${doctorId}`} className="block text-xs text-muted-foreground">
            Date
          </Label>
          <Input id={`date-${doctorId}`} name="date" type="date" required aria-label={`Absence date for ${doctorName}`} className="mt-1" />
        </div>
        <label className="flex items-center gap-1 pb-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={fullDay} onChange={(e) => setFullDay(e.target.checked)} /> Full day
        </label>
        {!fullDay ? (
          <>
            <div>
              <Label htmlFor={`from-${doctorId}`} className="block text-xs text-muted-foreground">
                From
              </Label>
              <Input id={`from-${doctorId}`} name="startTime" type="time" aria-label={`Absence start for ${doctorName}`} className="mt-1 w-28" />
            </div>
            <div>
              <Label htmlFor={`to-${doctorId}`} className="block text-xs text-muted-foreground">
                To
              </Label>
              <Input id={`to-${doctorId}`} name="endTime" type="time" aria-label={`Absence end for ${doctorName}`} className="mt-1 w-28" />
            </div>
          </>
        ) : null}
        <div className="grow">
          <Label htmlFor={`reason-${doctorId}`} className="block text-xs text-muted-foreground">
            Reason
          </Label>
          <Input id={`reason-${doctorId}`} name="reason" aria-label={`Absence reason for ${doctorName}`} className="mt-1" />
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Add absence"}
        </Button>
      </form>
    </div>
  );
}
