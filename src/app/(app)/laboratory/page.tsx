import { LabCatalog } from "@/features/lab/components/lab-catalog";
import { LabWorklist } from "@/features/lab/components/lab-worklist";
import { countLabWorklist, listLabTests, listLabWorklist } from "@/features/lab/queries";
import { getClinicTimeZone } from "@/features/doctors/queries";
import { hasPermission } from "@/lib/rbac/permissions";
import { requirePageAnyPermission } from "@/lib/rbac/page-guard";

export const metadata = { title: "Laboratory" };

export default async function LaboratoryPage() {
  // One queue, three stages, three different permissions: the bench opens it to
  // collect and report, a clinician to verify, an admin to maintain the catalog.
  const session = await requirePageAnyPermission(["lab:catalog", "lab:collect", "lab:verify"]);

  const clinicId = session.activeClinicId ?? "";
  const canCollect = hasPermission(session.activeRole, "lab:collect");
  const canVerify = hasPermission(session.activeRole, "lab:verify");
  const canCatalog = hasPermission(session.activeRole, "lab:catalog");
  // Withdrawing a request is the ordering clinician's call (`lab:order`), which
  // they exercise on the chart; this covers the platform admin passing through.
  const canCancel = hasPermission(session.activeRole, "lab:order");

  const [orders, counts, timeZone, catalog] = await Promise.all([
    listLabWorklist(clinicId),
    countLabWorklist(clinicId),
    getClinicTimeZone(clinicId),
    canCatalog ? listLabTests(clinicId, { includeInactive: true }) : Promise.resolve([]),
  ]);

  const summary = [
    counts.ORDERED ? `${counts.ORDERED} awaiting collection` : null,
    counts.COLLECTED ? `${counts.COLLECTED} in the lab` : null,
    counts.COMPLETED ? `${counts.COMPLETED} awaiting verification` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Laboratory</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {summary.length > 0 ? summary.join(" · ") : "No outstanding requests."}
        </p>
      </header>

      <LabWorklist
        orders={orders}
        timeZone={timeZone}
        canCollect={canCollect}
        canResult={canCollect}
        canVerify={canVerify}
        canCancel={canCancel}
      />

      {canCatalog ? <LabCatalog tests={catalog} /> : null}
    </div>
  );
}
