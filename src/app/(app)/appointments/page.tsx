import Link from "next/link";

import { BookAppointmentForm } from "@/features/appointments/components/book-appointment-dialog";
import { DaySlotGrid, type DaySlotAppointmentView } from "@/features/appointments/components/day-slot-grid";
import { listAppointmentsForRange } from "@/features/appointments/queries";
import { buildDayTimeline, type SlotAppointment } from "@/features/appointments/slots";
import { getClinicTimeZone, listDoctors } from "@/features/doctors/queries";
import { getDoctorProfileForUser } from "@/features/doctors/service";
import { listPatients } from "@/features/patients/queries";
import { hasPermission } from "@/lib/rbac/permissions";
import { requirePagePermission } from "@/lib/rbac/page-guard";
import { formatZonedTime, zonedDateString, zonedDayRange, zonedParts, zonedToday, zonedWeekRange } from "@/lib/timezone";

export const metadata = { title: "Appointments" };

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type SearchParams = { doctorId?: string; week?: string; date?: string; view?: string };

/** Shifts a `YYYY-MM-DD` string by whole days (pure calendar math). */
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

function qs(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ").toLowerCase();
}

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requirePagePermission("schedule:view");
  const params = await searchParams;
  const clinicId = session.activeClinicId ?? "";
  const timeZone = await getClinicTimeZone(clinicId);
  const canManage = hasPermission(session.activeRole, "appointments:manage");
  const view = params.view === "day" ? "day" : "week";

  // Doctors default to their own calendar; reception/admin see the whole clinic.
  let defaultDoctorId: string | undefined;
  if (!params.doctorId && session.activeRole === "DOCTOR") {
    const own = await getDoctorProfileForUser(session.user.id);
    if (own && own.clinicId === clinicId) defaultDoctorId = own.id;
  }

  const doctors = await listDoctors(clinicId);
  const doctorOptions = doctors.map((d) => ({ id: d.id, name: d.name, specialization: d.specialization }));
  const selectedDoctorId =
    params.doctorId && doctors.some((d) => d.id === params.doctorId) ? params.doctorId : defaultDoctorId;

  const today = zonedToday(timeZone);
  const dayDate = params.date && DATE_PATTERN.test(params.date) ? params.date : today;
  const weekAnchor = params.week && DATE_PATTERN.test(params.week) ? params.week : today;

  const patients = canManage
    ? (await listPatients(clinicId, { page: 1 })).rows.map((p) => ({
        id: p.id,
        mrn: p.mrn,
        firstName: p.firstName,
        lastName: p.lastName,
      }))
    : [];

  // -------------------------------------------------------------------------
  // Day view: one doctor's schedule turned into a slot grid.
  // -------------------------------------------------------------------------
  if (view === "day") {
    const dayDoctorId = selectedDoctorId ?? doctors[0]?.id;
    const doctor = doctors.find((d) => d.id === dayDoctorId) ?? null;
    const range = zonedDayRange(dayDate, timeZone);
    const rows = await listAppointmentsForRange(clinicId, {
      from: range.start,
      to: range.end,
      doctorId: dayDoctorId,
    });
    const schedule = doctor?.schedules.find((s) => s.weekday === zonedParts(range.start, timeZone).weekday) ?? null;
    const timeline = buildDayTimeline({
      date: dayDate,
      timeZone,
      schedule: schedule
        ? {
            weekday: schedule.weekday,
            startMinute: schedule.startMinute,
            endMinute: schedule.endMinute,
            slotMinutes: schedule.slotMinutes,
          }
        : null,
      appointments: rows.map<SlotAppointment>((r) => ({
        id: r.id,
        scheduledAt: r.scheduledAt,
        durationMinutes: r.durationMinutes,
        status: r.status,
        patientName: r.patientName,
        patientMrn: r.patientMrn,
      })),
    });
    const reasons = new Map(rows.map((r) => [r.id, r.reason]));
    const toView = (a: SlotAppointment): DaySlotAppointmentView => ({
      id: a.id,
      patientName: a.patientName,
      patientMrn: a.patientMrn ?? "",
      durationMinutes: a.durationMinutes,
      status: a.status,
      reason: reasons.get(a.id) ?? null,
    });

    return (
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Appointments</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {dayDate} {DAY_LABELS[zonedParts(range.start, timeZone).weekday]} · {session.activeClinicName} ·{" "}
              {timeZone}
            </p>
          </div>
          {canManage ? <BookAppointmentForm doctors={doctorOptions} patients={patients} timeZone={timeZone} /> : null}
        </header>

        <nav className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            href={`/appointments?${qs({ view: "day", date: shiftDate(dayDate, -1), doctorId: dayDoctorId })}`}
            className="rounded-md border px-3 py-1.5 hover:bg-muted"
          >
            ← Previous day
          </Link>
          <Link
            href={`/appointments?${qs({ view: "day", date: today, doctorId: dayDoctorId })}`}
            className="rounded-md border px-3 py-1.5 hover:bg-muted"
          >
            Today
          </Link>
          <Link
            href={`/appointments?${qs({ view: "day", date: shiftDate(dayDate, 1), doctorId: dayDoctorId })}`}
            className="rounded-md border px-3 py-1.5 hover:bg-muted"
          >
            Next day →
          </Link>
          <span className="mx-2 h-5 w-px bg-border" />
          <Link
            href={`/appointments?${qs({ week: shiftDate(dayDate, -zonedParts(range.start, timeZone).weekday) })}`}
            className="rounded-md border px-3 py-1.5 hover:bg-muted"
          >
            Week view
          </Link>
          <span className="mx-2 h-5 w-px bg-border" />
          {doctors.map((d) => (
            <Link
              key={d.id}
              href={`/appointments?${qs({ view: "day", date: dayDate, doctorId: d.id })}`}
              className={
                "rounded-md border px-3 py-1.5 hover:bg-muted " +
                (dayDoctorId === d.id ? "border-teal-600 font-medium text-teal-700 dark:text-teal-400" : "")
              }
            >
              {d.name}
            </Link>
          ))}
        </nav>

        <DaySlotGrid
          date={dayDate}
          timeZone={timeZone}
          doctor={doctor ? { id: doctor.id, name: doctor.name, specialization: doctor.specialization } : null}
          slots={timeline.slots.map((s) => ({
            label: s.label,
            startIso: s.start.toISOString(),
            endIso: s.end.toISOString(),
            appointment: s.appointment ? toView(s.appointment) : null,
          }))}
          outsideSchedule={timeline.outsideSchedule.map(toView)}
          patients={patients}
          canManage={canManage}
        />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Week view (default): the clinic-local Sunday-based week.
  // -------------------------------------------------------------------------
  const week = zonedWeekRange(weekAnchor, timeZone);
  const weekStart = week.days[0]!;
  const rows = await listAppointmentsForRange(clinicId, {
    from: week.start,
    to: week.end,
    doctorId: selectedDoctorId,
  });
  const byDay = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = zonedDateString(new Date(row.scheduledAt), timeZone);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(row);
    else byDay.set(key, [row]);
  }
  const weekQuery = (patch: Record<string, string | undefined>) =>
    `/appointments?${qs({ week: weekStart, doctorId: selectedDoctorId, ...patch })}`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Appointments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {weekStart} → {week.days[6]} · {session.activeClinicName} · {timeZone}
            {selectedDoctorId ? " · one doctor" : " · all doctors"}
          </p>
        </div>
        {canManage ? <BookAppointmentForm doctors={doctorOptions} patients={patients} timeZone={timeZone} /> : null}
      </header>

      <nav className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={weekQuery({ week: shiftDate(weekStart, -7) })} className="rounded-md border px-3 py-1.5 hover:bg-muted">
          ← Previous week
        </Link>
        <Link href={weekQuery({ week: today })} className="rounded-md border px-3 py-1.5 hover:bg-muted">
          This week
        </Link>
        <Link href={weekQuery({ week: shiftDate(weekStart, 7) })} className="rounded-md border px-3 py-1.5 hover:bg-muted">
          Next week →
        </Link>
        <span className="mx-2 h-5 w-px bg-border" />
        <Link
          href={weekQuery({ view: "day", date: today, doctorId: selectedDoctorId ?? doctors[0]?.id })}
          className="rounded-md border px-3 py-1.5 hover:bg-muted"
        >
          Day view
        </Link>
        <span className="mx-2 h-5 w-px bg-border" />
        <Link
          href={weekQuery({ doctorId: undefined })}
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
            href={weekQuery({ doctorId: d.id })}
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
        {week.days.map((date, i) => {
          const dayRows = byDay.get(date) ?? [];
          return (
            <section key={date} className="rounded-lg border bg-white p-3 dark:bg-zinc-900">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {date} {DAY_LABELS[i]}
              </h2>
              <ul className="mt-2 space-y-2">
                {dayRows.map((r) => (
                  <li key={r.id} className="rounded-md border bg-muted/30 p-2 text-xs">
                    <p className="font-medium">
                      {formatZonedTime(new Date(r.scheduledAt), timeZone)} · {r.patientName}
                    </p>
                    <p className="text-muted-foreground">
                      {!selectedDoctorId ? `${r.doctorName} · ` : ""}
                      {statusLabel(r.status)}
                    </p>
                    <Link href={`/appointments/${r.id}`} className="text-teal-700 hover:underline dark:text-teal-400">
                      details
                    </Link>
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
