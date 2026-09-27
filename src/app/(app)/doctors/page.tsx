import Link from "next/link";

import { AddDoctorForm, TimeOffEditor } from "@/features/doctors/components/doctor-admin";
import { DoctorScheduleEditor } from "@/features/doctors/components/schedule-editor";
import {
  formatScheduleSummary,
  getClinicTimeZone,
  listDoctorProfileCandidates,
  listDoctors,
} from "@/features/doctors/queries";
import { hasPermission } from "@/lib/rbac/permissions";
import { requirePagePermission } from "@/lib/rbac/page-guard";

export const metadata = { title: "Doctors" };

export default async function DoctorsPage() {
  const session = await requirePagePermission("schedule:view");
  const clinicId = session.activeClinicId ?? "";
  const canManage = hasPermission(session.activeRole, "schedule:manage");

  const [doctors, candidates, timeZone] = await Promise.all([
    listDoctors(clinicId),
    canManage ? listDoctorProfileCandidates(clinicId) : Promise.resolve([]),
    getClinicTimeZone(clinicId),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Doctors</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {doctors.length} doctor(s) at {session.activeClinicName} · working hours in {timeZone}
            {canManage ? " — edit hours, add absences inline" : ""}
          </p>
        </div>
        {canManage ? <AddDoctorForm candidates={candidates} /> : null}
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
                href={`/appointments?view=day&doctorId=${d.id}`}
                className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
              >
                View day grid →
              </Link>
            </div>
            {canManage ? (
              <>
                <DoctorScheduleEditor doctorId={d.id} doctorName={d.name} initialRows={d.schedules} />
                <TimeOffEditor
                  doctorId={d.id}
                  doctorName={d.name}
                  timeZone={timeZone}
                  timeOff={d.upcomingTimeOff}
                />
              </>
            ) : (
              <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                <p>Working hours: {formatScheduleSummary(d.schedules)}</p>
                <p>
                  Upcoming absences:{" "}
                  {d.upcomingTimeOff.length === 0
                    ? "none"
                    : d.upcomingTimeOff.map((t) => t.startsAt.slice(0, 10)).join(", ")}
                </p>
              </div>
            )}
          </div>
        ))}
        {doctors.length === 0 ? (
          <p className="rounded-lg border bg-white p-6 text-sm text-muted-foreground dark:bg-zinc-900">
            No doctor profiles yet.
            {canManage && candidates.length === 0
              ? " Invite a doctor-role staff member first, then add their profile here."
              : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}
