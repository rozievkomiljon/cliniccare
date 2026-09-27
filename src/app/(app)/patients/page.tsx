import { requirePermission } from "@/lib/rbac/guard";

export const metadata = { title: "Patients" };

export default async function PatientsPage() {
  await requirePermission("patients:view");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Patients</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Patient registry arrives in Phase 2 with registration, search, and profiles.
        </p>
      </header>
    </div>
  );
}
