import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AppointmentActions,
} from "@/features/appointments/components/appointment-actions";
import { getAppointmentForClinic } from "@/features/appointments/queries";
import { hasPermission } from "@/lib/rbac/permissions";
import { requirePagePermission } from "@/lib/rbac/page-guard";

export const metadata = { title: "Appointment" };

function fmtWhen(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export default async function AppointmentDetailPage({
  params,
}: {
  params: Promise<{ appointmentId: string }>;
}) {
  const session = await requirePagePermission("schedule:view");
  const { appointmentId } = await params;
  const appointment = await getAppointmentForClinic(session.activeClinicId ?? "", appointmentId);
  if (!appointment) notFound();

  const canManage = hasPermission(session.activeRole, "appointments:manage");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <nav>
        <Link href="/appointments" className="text-sm text-teal-700 hover:underline dark:text-teal-400">
          ← Back to calendar
        </Link>
      </nav>

      <header>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {appointment.status.replaceAll("_", " ")}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {appointment.patientName} · {fmtWhen(appointment.scheduledAt)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {appointment.durationMinutes} min with {appointment.doctorName}
          {appointment.reason ? ` — ${appointment.reason}` : ""}
        </p>
      </header>

      {canManage ? <AppointmentActions appointment={appointment} /> : null}

      <section className="rounded-lg border bg-white p-5 dark:bg-zinc-900">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          History
        </h2>
        <ol className="space-y-3">
          {appointment.events.map((ev) => (
            <li key={ev.id} className="border-l-2 border-teal-600/40 pl-3 text-sm">
              <p className="font-medium">
                {ev.type} <span className="font-normal text-muted-foreground">by {ev.actorName}</span>
              </p>
              {ev.detail ? <p className="text-muted-foreground">{ev.detail}</p> : null}
              <p className="text-xs text-muted-foreground">{fmtWhen(ev.createdAt.toISOString())}</p>
            </li>
          ))}
          {appointment.events.length === 0 ? (
            <li className="text-sm text-muted-foreground">No events recorded.</li>
          ) : null}
        </ol>
      </section>
    </div>
  );
}
