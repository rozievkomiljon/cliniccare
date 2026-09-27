import { requirePermission } from "@/lib/rbac/guard";
import { db } from "@/lib/db";

export const metadata = { title: "Clinics" };

export default async function AdminClinicsPage() {
  const session = await requirePermission("clinics:manage");
  const clinics = await db.clinic.findMany({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true, timezone: true, createdAt: true },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Clinics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Platform administration for {clinics.length} clinic(s), {session.user.email}.
        </p>
      </header>
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Slug</th>
              <th className="px-4 py-2 font-medium">Timezone</th>
            </tr>
          </thead>
          <tbody>
            {clinics.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="px-4 py-2">{c.name}</td>
                <td className="px-4 py-2 font-mono text-xs">{c.slug}</td>
                <td className="px-4 py-2">{c.timezone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Clinic provisioning UI arrives with Phase 2.
      </p>
    </div>
  );
}
