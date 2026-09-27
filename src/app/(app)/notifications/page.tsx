import Link from "next/link";
import { redirect } from "next/navigation";

import { MarkAllReadButton } from "@/features/notifications/components/mark-all-read";
import { listNotificationsForPatientUser, listNotificationsForUser } from "@/features/notifications/queries";
import { getSession } from "@/lib/rbac/guard";
import { hasPermission } from "@/lib/rbac/permissions";

export const metadata = { title: "Notifications" };

function fmt(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export default async function NotificationsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Patients see portal notifications; staff see their own feed.
  const isPatientOnly = !hasPermission(session.activeRole, "dashboard:view");
  const rows = isPatientOnly
    ? await listNotificationsForPatientUser(session.user.id)
    : await listNotificationsForUser(session.user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">Booking changes for you</p>
        </div>
        <MarkAllReadButton />
      </header>

      <ul className="space-y-2">
        {rows.map((n) => (
          <li
            key={n.id}
            className={
              "rounded-lg border bg-white p-4 text-sm dark:bg-zinc-900 " +
              (n.readAt ? "opacity-70" : "border-teal-600/50")
            }
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-medium">{n.title}</p>
              <p className="shrink-0 text-xs text-muted-foreground">{fmt(n.createdAt.toISOString())}</p>
            </div>
            <p className="mt-1 text-muted-foreground">{n.body}</p>
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="rounded-lg border bg-white p-6 text-sm text-muted-foreground dark:bg-zinc-900">
            Nothing here yet — booking changes will show up as notifications.
          </li>
        ) : null}
      </ul>

      <p>
        <Link href={isPatientOnly ? "/portal" : "/dashboard"} className="text-sm text-teal-700 hover:underline dark:text-teal-400">
          ← Back
        </Link>
      </p>
    </div>
  );
}
