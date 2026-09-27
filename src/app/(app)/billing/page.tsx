import { requirePagePermission } from "@/lib/rbac/page-guard";

export const metadata = { title: "Billing" };

export default async function BillingPage() {
  await requirePagePermission("billing:view");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">Invoices and payments arrive in Phase 7.</p>
      </header>
    </div>
  );
}
