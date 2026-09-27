import { requirePermission } from "@/lib/rbac/guard";
import { listAuditLog } from "@/features/audit/queries";

export const metadata = { title: "Audit log" };

export default async function AuditPage() {
  const session = await requirePermission("audit:view");
  const rows = await listAuditLog(session.activeClinicId ?? "", 200);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sensitive actions in {session.activeClinicName}, newest first (last 200).
        </p>
      </header>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Action</th>
              <th className="px-4 py-2 font-medium">Entity</th>
              <th className="px-4 py-2 font-medium">Actor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                  {row.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC
                </td>
                <td className="px-4 py-2 font-mono text-xs">{row.action}</td>
                <td className="px-4 py-2">
                  {row.entityType}
                  {row.entityId ? <span className="text-muted-foreground"> · {row.entityId}</span> : null}
                </td>
                <td className="px-4 py-2">{row.actorName ?? row.actorEmail ?? "system"}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  No audit entries yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
