"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { upsertDoctorScheduleAction } from "@/features/doctors/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type ScheduleRowUi = {
  weekday: number;
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
};

function toTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function fromTime(value: string): number {
  const [h = 0, m = 0] = value.split(":").map(Number);
  return h * 60 + m;
}

export function DoctorScheduleEditor({
  doctorId,
  doctorName,
  initialRows,
}: {
  doctorId: string;
  doctorName: string;
  initialRows: ScheduleRowUi[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<ScheduleRowUi[]>(initialRows);

  if (!open) {
    return (
      <div className="mt-3 flex items-center gap-3">
        <p className="text-sm text-muted-foreground">
          Working hours: {rows.length === 0 ? "No schedule yet" : rows.map((r) => `${DAY_LABELS[r.weekday]} ${toTime(r.startMinute)}-${toTime(r.endMinute)}`).join(", ")}
        </p>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Edit schedule
        </Button>
      </div>
    );
  }

  const setRow = (index: number, patch: Partial<ScheduleRowUi>) =>
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setSaved(false);
        startTransition(async () => {
          const result = await upsertDoctorScheduleAction({ doctorId, rows });
          if (result.ok) {
            setSaved(true);
            setOpen(false);
            router.refresh();
          } else {
            setError(result.error);
          }
        });
      }}
    >
      <p className="text-sm font-medium">Weekly hours — {doctorName}</p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {saved && !error ? <p className="text-sm text-teal-700 dark:text-teal-400">Schedule saved.</p> : null}

      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor={`day-${i}`} className="block text-xs text-muted-foreground">
              Day
            </Label>
            <select
              id={`day-${i}`}
              aria-label="Weekday"
              value={row.weekday}
              onChange={(e) => setRow(i, { weekday: Number(e.target.value) })}
              className="mt-1 rounded-md border bg-transparent px-2 py-1.5 text-sm"
            >
              {DAY_LABELS.map((label, idx) => (
                <option key={idx} value={idx}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor={`start-${i}`} className="block text-xs text-muted-foreground">
              From
            </Label>
            <Input
              id={`start-${i}`}
              type="time"
              aria-label="Start time"
              value={toTime(row.startMinute)}
              onChange={(e) => setRow(i, { startMinute: fromTime(e.target.value) })}
              className="mt-1 w-28"
            />
          </div>
          <div>
            <Label htmlFor={`end-${i}`} className="block text-xs text-muted-foreground">
              To
            </Label>
            <Input
              id={`end-${i}`}
              type="time"
              aria-label="End time"
              value={toTime(row.endMinute)}
              onChange={(e) => setRow(i, { endMinute: fromTime(e.target.value) })}
              className="mt-1 w-28"
            />
          </div>
          <div>
            <Label htmlFor={`slot-${i}`} className="block text-xs text-muted-foreground">
              Slot (min)
            </Label>
            <Input
              id={`slot-${i}`}
              type="number"
              min={5}
              max={240}
              aria-label="Slot minutes"
              value={row.slotMinutes}
              onChange={(e) => setRow(i, { slotMinutes: Number(e.target.value) })}
              className="mt-1 w-24"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Remove day ${DAY_LABELS[row.weekday]}`}
            onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
          >
            Remove
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRows((prev) => [...prev, { weekday: 1, startMinute: 540, endMinute: 1020, slotMinutes: 30 }])}
        >
          Add day
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save schedule"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setRows(initialRows);
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
