import { requirePagePermission } from "@/lib/rbac/page-guard";

export const metadata = { title: "Laboratory" };

export default async function LaboratoryPage() {
  await requirePagePermission("lab:collect");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Laboratory queue</h1>
        <p className="mt-1 text-sm text-muted-foreground">Orders and samples arrive in Phase 5.</p>
      </header>
    </div>
  );
}
