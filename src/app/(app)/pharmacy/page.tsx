import { requirePermission } from "@/lib/rbac/guard";

export const metadata = { title: "Pharmacy" };

export default async function PharmacyPage() {
  await requirePermission("pharmacy:catalog");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Pharmacy inventory</h1>
        <p className="mt-1 text-sm text-muted-foreground">Medicines and stock arrive in Phase 6.</p>
      </header>
    </div>
  );
}
