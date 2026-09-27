import Link from "next/link";

import { DoctorScheduleEditor } from "@/features/doctors/components/schedule-editor";
import { listDoctors, formatScheduleSummary } from "@/features/doctors/queries";
import { hasPermission } from "@/lib/rbac/permissions";
import { requirePagePermission } from "@/lib/rbac/page-guard";

export const metadata = { title: "Doctors" };

export default async function DoctorsPage() {
  const session = await requirePagePermission("schedule:view");
  const doctors = await listDoctors(session.activeClinicId ?? "");
  const canManage = hasPermission(session.activeRole, "schedule:manage");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Doctors</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {doctors.length} doctor(s) at {session.activeClinicName}
          {canManage ? " — edit weekly hours inline" : ""}
        </p>
      </header>

      <div className="space-y-4">
        {doctors.map((d) => (
          <div key={d.id} className="rounded-lg border bg-white p-5 dark:bg-zinc-900">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-medium">{d.name}</p>
                <p className="text-sm text-muted-foreground">{d.specialization}</p>
                <p className="mt-1 text-xs text-muted-foreground">{d.email}</p>
              </div>
              <Link
                href={`/appointments?doctorId=${d.id}`}
                className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
              >
                View calendar →
              </Link>
            </div>
            {canManage ? (
              <DoctorScheduleEditor doctorId={d.id} doctorName={d.name} initialRows={d.schedules} />
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Working hours: {formatScheduleSummary(d.schedules)}
              </p>
            )}
          </div>
        ))}
        {doctors.length === 0 ? (
          <p className="rounded-lg border bg-white p-6 text-sm text-muted-foreground dark:bg-zinc-900">
            No doctor profiles yet.
          </p>
        ) : null}
      </div>
    </div>
  );
}
