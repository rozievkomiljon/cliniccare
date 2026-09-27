import { requirePagePermission } from "@/lib/rbac/page-guard";

export const metadata = { title: "My health" };

export default async function PortalPage() {
  const session = await requirePagePermission("portal:access");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My health</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome, {session.user.name}. Your appointments and results appear here.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border p-4 text-sm">
          <div className="font-medium">Upcoming appointments</div>
          <div className="mt-1 text-muted-foreground">Phase 3 adds booking and reminders.</div>
        </div>
        <div className="rounded-lg border p-4 text-sm">
          <div className="font-medium">Lab results</div>
          <div className="mt-1 text-muted-foreground">
            Verified results appear in Phase 5.
          </div>
        </div>
      </div>
    </div>
  );
}
