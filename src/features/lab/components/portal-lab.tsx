import { getClinicTimeZone } from "@/features/doctors/queries";
import { fmtStamp, labFlagLabel, labFlagTone } from "@/features/lab/format";
import { listPortalLabResults } from "@/features/lab/queries";

const flagCls: Record<"critical" | "attention" | "normal", string> = {
  critical: "font-semibold text-red-700 dark:text-red-400",
  attention: "font-medium text-amber-700 dark:text-amber-400",
  normal: "",
};

/**
 * Server component: the patient's own released laboratory results. Scoped by the
 * patient id resolved from the portal session and limited to VERIFIED orders —
 * an unverified result has not been checked by a clinician yet.
 */
export async function PortalLabResults({
  patientId,
  clinicId,
}: {
  patientId: string;
  clinicId: string;
}) {
  const [orders, timeZone] = await Promise.all([
    listPortalLabResults(patientId),
    getClinicTimeZone(clinicId),
  ]);

  return (
    <section className="rounded-lg border bg-white p-5 text-sm dark:bg-zinc-900">
      <h2 className="mb-3 font-semibold uppercase tracking-wide text-muted-foreground">My lab results</h2>
      {orders.length === 0 ? (
        <p className="text-muted-foreground">No results have been released yet.</p>
      ) : (
        <ul className="space-y-4">
          {orders.map((order) => (
            <li key={order.id} className="rounded-md border p-3">
              <p className="font-medium">
                {order.verifiedAt ? `Released ${fmtStamp(order.verifiedAt, timeZone)}` : "Released"}
                {order.doctorName ? ` — ${order.doctorName}` : ""}
              </p>
              <ul className="mt-1 space-y-1">
                {order.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap justify-between gap-2">
                    <span>
                      {item.testName}{" "}
                      <span className="font-mono text-xs text-muted-foreground">{item.testCode}</span>
                    </span>
                    <span className={flagCls[labFlagTone(item.flag)]}>
                      {item.resultValue ?? "—"}
                      {item.unit ? ` ${item.unit}` : ""}
                      {item.referenceRange ? (
                        <span className="font-normal text-muted-foreground"> (ref {item.referenceRange})</span>
                      ) : null}
                      {labFlagLabel(item.flag) ? ` · ${labFlagLabel(item.flag)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        Results appear here once your care team has verified them. Questions? Ask at your next visit.
      </p>
    </section>
  );
}
