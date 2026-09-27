import Link from "next/link";

import { BookAppointmentForm } from "@/features/appointments/components/book-appointment-dialog";
import { listAppointmentsForRange } from "@/features/appointments/queries";
import { getDoctorProfileForUser } from "@/features/doctors/service";
import { listDoctors } from "@/features/doctors/queries";
import { listPatients } from "@/features/patients/queries";
import { hasPermission } from "@/lib/rbac/permissions";
import { requirePagePermission } from "@/lib/rbac/page-guard";

export const metadata = { title: "Appointments" };

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcWeek(anchor: Date): Date {
  const d = new Date(anchor);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // Sunday
  return d;
}

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ doctorId?: string; week?: string }>;
}) {
  const session = await requirePagePermission("schedule:view");
  const { doctorId, week } = await searchParams;

  // Doctors default to their own calendar; reception/admin see the whole clinic.
  let defaultDoctorId: string | undefined;
  if (!doctorId && session.activeRole === "DOCTOR") {
    const own = await getDoctorProfileForUser(session.user.id);
    if (own && own.clinicId === session.activeClinicId) defaultDoctorId = own.id;
  }

  const from = week ? startOfUtcWeek(new Date(`${week}T00:00:00.000Z`)) : startOfUtcWeek(new Date());
  const to = new Date(from.getTime() + 7 * DAY_MS);

  const canManage = hasPermission(session.activeRole, "appointments:manage");

  const doctors = await listDoctors(session.activeClinicId ?? "");
  const patients = canManage
    ? (await listPatients(session.activeClinicId ?? "", { page: 1 })).rows.map((p) => ({
        id: p.id,
        mrn: p.mrn,
        firstName: p.firstName,
        lastName: p.lastName,
      }))
    : [];
  const selectedDoctorId =
    doctorId && doctors.some((d) => d.id === doctorId) ? doctorId : defaultDoctorId;
  const rows = await listAppointmentsForRange(session.activeClinicId ?? "", {
    from,
    to,
    doctorId: selectedDoctorId,
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Appointments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {from.toISOString().slice(0, 10)} → {new Date(to.getTime() - DAY_MS).toISOString().slice(0, 10)}
            {" · "}
            {session.activeClinicName}
            {selectedDoctorId ? " · one doctor" : " · all doctors"}
          </p>
        </div>
        {canManage ? <BookAppointmentForm doctors={doctors} patients={patients} /> : null}
      </header>

      <nav className="flex flex-wrap items-center gap-2 text-sm">
        <Link
          href={`/appointments?${new URLSearchParams({ ...(selectedDoctorId ? { doctorId: selectedDoctorId } : {}), week: new Date(from.getTime() - 7 * DAY_MS).toISOString().slice(0, 10) })}`}
          className="rounded-md border px-3 py-1.5 hover:bg-muted"
        >
          ← Previous week
        </Link>
        <Link
          href={`/appointments?${new URLSearchParams({ ...(selectedDoctorId ? { doctorId: selectedDoctorId } : {}) })}`}
          className="rounded-md border px-3 py-1.5 hover:bg-muted"
        >
          This week
        </Link>
        <Link
          href={`/appointments?${new URLSearchParams({ ...(selectedDoctorId ? { doctorId: selectedDoctorId } : {}), week: new Date(from.getTime() + 7 * DAY_MS).toISOString().slice(0, 10) })}`}
          className="rounded-md border px-3 py-1.5 hover:bg-muted"
        >
          Next week →
        </Link>
        <span className="mx-2 h-5 w-px bg-border" />
        <Link
          href={`/appointments?${new URLSearchParams({ week: from.toISOString().slice(0, 10) })}`}
          className={
            "rounded-md border px-3 py-1.5 hover:bg-muted " +
            (!selectedDoctorId ? "border-teal-600 font-medium text-teal-700 dark:text-teal-400" : "")
          }
        >
          All doctors
        </Link>
        {doctors.map((d) => (
          <Link
            key={d.id}
            href={`/appointments?${new URLSearchParams({ doctorId: d.id, week: from.toISOString().slice(0, 10) })}`}
            className={
              "rounded-md border px-3 py-1.5 hover:bg-muted " +
              (selectedDoctorId === d.id ? "border-teal-600 font-medium text-teal-700 dark:text-teal-400" : "")
            }
          >
            {d.name}
          </Link>
        ))}
      </nav>

      <div className="grid gap-3 md:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => {
          const day = new Date(from.getTime() + i * DAY_MS);
          const dayRows = rows.filter((r) => {
            const t = new Date(r.scheduledAt);
            return t.getUTCFullYear() === day.getUTCFullYear() && t.getUTCMonth() === day.getUTCMonth() && t.getUTCDate() === day.getUTCDate();
          });
          return (
            <section key={i} className="rounded-lg border bg-white p-3 dark:bg-zinc-900">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {day.toISOString().slice(0, 10)} {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][i]}
              </h2>
              <ul className="mt-2 space-y-2">
                {dayRows.map((r) => (
                  <li key={r.id} className="rounded-md border bg-muted/30 p-2 text-xs">
                    <p className="font-medium">
                      {r.scheduledAt.slice(11, 16)} · {r.patientName}
                    </p>
                    <p className="text-muted-foreground">
                      {!selectedDoctorId ? `${r.doctorName} · ` : ""}
                      {r.status.replaceAll("_", " ").toLowerCase()}
                    </p>
                    <a href={`/appointments/${r.id}`} className="text-teal-700 hover:underline dark:text-teal-400">
                      details
                    </a>
                  </li>
                ))}
                {dayRows.length === 0 ? <li className="text-xs text-muted-foreground">—</li> : null}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
