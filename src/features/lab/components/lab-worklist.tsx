"use client";

import { LabOrderCard } from "@/features/lab/components/lab-record";
import type { LabOrderDto } from "@/features/lab/service";

const STAGES: Array<{ status: string; heading: string; hint: string }> = [
  { status: "ORDERED", heading: "Awaiting collection", hint: "Draw the sample, then mark it collected." },
  { status: "COLLECTED", heading: "In the lab", hint: "Record a result for every test on the request." },
  { status: "COMPLETED", heading: "Awaiting verification", hint: "All results are in; a clinician releases them." },
];

/**
 * The bench queue: each request grouped by the action it needs next. Capability
 * props decide which controls appear — the collection and result steps belong to
 * `lab:collect`, verification to `lab:verify`.
 */
export function LabWorklist({
  orders,
  timeZone,
  canCollect,
  canResult,
  canVerify,
  canCancel,
}: {
  orders: LabOrderDto[];
  timeZone: string;
  canCollect: boolean;
  canResult: boolean;
  canVerify: boolean;
  canCancel: boolean;
}) {
  const grouped = STAGES.map((stage) => ({
    ...stage,
    orders: orders.filter((order) => order.status === stage.status),
  }));

  if (orders.length === 0) {
    return (
      <p className="rounded-lg border bg-white p-5 text-sm text-muted-foreground dark:bg-zinc-900">
        The laboratory queue is empty.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {grouped
        .filter((stage) => stage.orders.length > 0)
        .map((stage) => (
          <section key={stage.status} className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {stage.heading} ({stage.orders.length})
              </h2>
              <p className="text-xs text-muted-foreground">{stage.hint}</p>
            </div>
            <ul className="space-y-2">
              {stage.orders.map((order) => (
                <LabOrderCard
                  key={order.id}
                  order={order}
                  timeZone={timeZone}
                  showPatient
                  canCollect={canCollect}
                  canResult={canResult}
                  canVerify={canVerify}
                  canCancel={canCancel}
                />
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
