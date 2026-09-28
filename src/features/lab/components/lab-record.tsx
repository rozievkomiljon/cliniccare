"use client";

import { useState } from "react";

import {
  cancelLabOrderAction,
  collectLabOrderSampleAction,
  enterLabResultsAction,
  placeLabOrderAction,
  verifyLabOrderAction,
} from "@/features/lab/actions";
import { Feedback, inputCls, labelCls, useSubmit } from "@/features/lab/components/submit";
import { fmtStamp, labFlagLabel, labFlagTone, labPriorityLabel, labProgress, labStatusLabel } from "@/features/lab/format";
import type { LabOrderDto, LabTestDto } from "@/features/lab/service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PRIORITIES = ["ROUTINE", "URGENT", "STAT"] as const;
const FLAGS = ["NORMAL", "LOW", "HIGH", "CRITICAL"] as const;

const selectCls = "mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm";
const flagCls: Record<"critical" | "attention" | "normal", string> = {
  critical: "font-semibold text-red-700 dark:text-red-400",
  attention: "font-medium text-amber-700 dark:text-amber-400",
  normal: "",
};

const statusBadge: Record<string, string> = {
  ORDERED: "border-slate-400/50 text-muted-foreground",
  COLLECTED: "border-sky-500/50 text-sky-700 dark:text-sky-400",
  COMPLETED: "border-amber-500/50 text-amber-700 dark:text-amber-400",
  VERIFIED: "border-teal-600/40 text-teal-700 dark:text-teal-400",
  CANCELLED: "border-red-500/40 text-red-700 dark:text-red-400",
};

/** Raises a laboratory request against a patient's chart. */
export function OrderLabTestForm({
  patientId,
  doctors,
  tests,
  defaultDoctorId,
}: {
  patientId: string;
  doctors: Array<{ id: string; name: string; specialization: string }>;
  tests: LabTestDto[];
  defaultDoctorId?: string;
}) {
  const [open, setOpen] = useState(false);
  const { error, pending, run } = useSubmit(() => setOpen(false));

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Order lab tests</Button>;
  }

  const byCategory = new Map<string, LabTestDto[]>();
  for (const test of tests) {
    byCategory.set(test.category, [...(byCategory.get(test.category) ?? []), test]);
  }

  return (
    <form
      className="w-full space-y-4 rounded-xl border bg-white p-5 dark:bg-zinc-900"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        run(
          () =>
            placeLabOrderAction({
              patientId,
              doctorId: String(form.get("doctorId") ?? ""),
              priority: String(form.get("priority") ?? "ROUTINE") as never,
              indication: String(form.get("indication") ?? ""),
              testIds: form.getAll("testIds").map(String),
            }),
          "Laboratory request placed.",
        );
      }}
    >
      <h3 className="text-sm font-semibold">Order laboratory tests</h3>

      {tests.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This clinic&apos;s test catalog is empty. A lab administrator can add tests under Laboratory → Catalog.
        </p>
      ) : (
        <fieldset className="space-y-3">
          <legend className={labelCls}>Tests</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {[...byCategory.entries()].map(([category, group]) => (
              <div key={category} className="rounded-lg border p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {category}
                </p>
                <ul className="space-y-1.5">
                  {group.map((test) => (
                    <li key={test.id} className="flex items-start gap-2">
                      <input
                        id={`lab-test-${test.id}`}
                        type="checkbox"
                        name="testIds"
                        value={test.id}
                        aria-label={test.name}
                        className="mt-0.5"
                      />
                      <label htmlFor={`lab-test-${test.id}`} className="text-sm leading-tight">
                        {test.name}
                        <span className="text-muted-foreground">
                          {" "}
                          · {test.code}
                          {test.referenceRange ? ` · ref ${test.referenceRange}` : ""}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </fieldset>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="lab-priority" className={labelCls}>
            Priority
          </Label>
          <select id="lab-priority" name="priority" aria-label="Priority" defaultValue="ROUTINE" className={selectCls}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {labPriorityLabel(p)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="lab-doctor" className={labelCls}>
            Ordering clinician
          </Label>
          <select
            id="lab-doctor"
            name="doctorId"
            aria-label="Ordering clinician"
            defaultValue={defaultDoctorId}
            className={selectCls}
          >
            <option value="">Not specified</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} — {d.specialization}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="lab-indication" className={labelCls}>
            Indication
          </Label>
          <Input
            id="lab-indication"
            name="indication"
            aria-label="Indication"
            placeholder="Why the test is needed"
            className={inputCls}
          />
        </div>
      </div>

      <Feedback error={error} notice={null} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || tests.length === 0}>
          {pending ? "Placing…" : "Place order"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Bench-side result entry. Blank rows are simply not reported yet. */
function LabResultsForm({ order }: { order: LabOrderDto }) {
  const { error, notice, pending, run, setError } = useSubmit();

  return (
    <form
      className="space-y-3 border-t pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const items = order.items
          .map((item) => ({
            itemId: item.id,
            resultValue: String(form.get(`value-${item.id}`) ?? "").trim(),
            flag: String(form.get(`flag-${item.id}`) ?? ""),
            comment: String(form.get(`comment-${item.id}`) ?? ""),
          }))
          .filter((entry) => entry.resultValue !== "");

        if (items.length === 0) {
          setError("Enter at least one result.");
          return;
        }
        run(
          () => enterLabResultsAction({ orderId: order.id, items }),
          "Results saved.",
        );
      }}
    >
      <Feedback error={error} notice={notice} />
      <div className="space-y-3">
        {order.items.map((item) => (
          <div key={item.id} className="grid gap-2 sm:grid-cols-[1.2fr_0.8fr_1fr]">
            <div>
              <Label htmlFor={`lab-value-${item.id}`} className={labelCls}>
                {item.testName}
                {item.referenceRange ? <span className="text-muted-foreground"> (ref {item.referenceRange})</span> : null}
              </Label>
              <Input
                id={`lab-value-${item.id}`}
                name={`value-${item.id}`}
                aria-label={`${item.testName} result`}
                defaultValue={item.resultValue ?? ""}
                className={inputCls}
              />
            </div>
            <div>
              <Label htmlFor={`lab-flag-${item.id}`} className={labelCls}>
                Flag
              </Label>
              <select
                id={`lab-flag-${item.id}`}
                name={`flag-${item.id}`}
                aria-label={`${item.testName} flag`}
                defaultValue={item.flag ?? ""}
                className={selectCls}
              >
                <option value="">not flagged</option>
                {FLAGS.map((flag) => (
                  <option key={flag} value={flag}>
                    {flag.toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor={`lab-comment-${item.id}`} className={labelCls}>
                Comment
              </Label>
              <Input
                id={`lab-comment-${item.id}`}
                name={`comment-${item.id}`}
                aria-label={`${item.testName} comment`}
                defaultValue={item.comment ?? ""}
                className={inputCls}
              />
            </div>
          </div>
        ))}
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save results"}
      </Button>
    </form>
  );
}

/**
 * One laboratory request. The capability props decide which controls render:
 * the chart offers ordering, review, verification and cancellation, while the
 * bench queue adds collection and result entry. Hiding a control is cosmetic —
 * each action re-checks its own permission server-side.
 */
export function LabOrderCard({
  order,
  timeZone,
  canCollect = false,
  canResult = false,
  canVerify = false,
  canCancel = false,
  showPatient = false,
}: {
  order: LabOrderDto;
  timeZone: string;
  canCollect?: boolean;
  canResult?: boolean;
  canVerify?: boolean;
  canCancel?: boolean;
  showPatient?: boolean;
}) {
  const collect = useSubmit();
  const verify = useSubmit();
  const cancel = useSubmit();

  const resultsEditable =
    canResult && (order.status === "COLLECTED" || order.status === "COMPLETED");

  return (
    <li data-testid="lab-order-card" className="rounded-lg border bg-white p-4 text-sm dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {showPatient ? `${order.patientName} · ${order.patientMrn} · ` : ""}
            {fmtStamp(order.orderedAt, timeZone)}
            <span className={`ml-2 rounded border px-1.5 py-0.5 text-xs ${statusBadge[order.status] ?? ""}`}>
              {labStatusLabel(order.status)}
            </span>
            {order.priority !== "ROUTINE" ? (
              <span className="ml-1 rounded border border-red-500/40 px-1.5 py-0.5 text-xs text-red-700 dark:text-red-400">
                {labPriorityLabel(order.priority)}
              </span>
            ) : null}
          </p>
          <p className="text-muted-foreground">
            Ordered by {order.orderedByName}
            {order.doctorName ? ` · ${order.doctorName}` : ""} · {labProgress(order.items)}
            {order.indication ? ` · ${order.indication}` : ""}
          </p>
        </div>
      </div>

      <ul className="mt-3 space-y-1">
        {order.items.map((item) => (
          <li key={item.id} className="flex flex-wrap justify-between gap-2">
            <span>
              {item.testName} <span className="font-mono text-xs text-muted-foreground">{item.testCode}</span>
              {item.referenceRange ? (
                <span className="text-muted-foreground"> · ref {item.referenceRange}</span>
              ) : null}
            </span>
            <span className={flagCls[labFlagTone(item.flag)]}>
              {item.resultValue === null
                ? "pending"
                : `${item.resultValue}${item.unit ? ` ${item.unit}` : ""}`}
              {labFlagLabel(item.flag) ? ` (${labFlagLabel(item.flag)})` : ""}
              {item.comment ? <span className="text-muted-foreground"> — {item.comment}</span> : null}
            </span>
          </li>
        ))}
      </ul>

      {order.verifiedAt ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Verified by {order.verifiedByName} · {fmtStamp(order.verifiedAt, timeZone)}
        </p>
      ) : null}
      {order.cancelledAt ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Cancelled by {order.cancelledByName} · {fmtStamp(order.cancelledAt, timeZone)}
        </p>
      ) : null}

      {resultsEditable ? (
        <div className="mt-3">
          <LabResultsForm order={order} />
        </div>
      ) : (
        <Feedback error={collect.error ?? verify.error ?? cancel.error} notice={collect.notice} />
      )}

      {canCollect && order.status === "ORDERED" ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={collect.pending}
          onClick={() => collect.run(() => collectLabOrderSampleAction({ orderId: order.id }), "Sample marked collected.")}
        >
          {collect.pending ? "Recording…" : "Mark sample collected"}
        </Button>
      ) : null}

      {canVerify && order.status === "COMPLETED" ? (
        <Button
          size="sm"
          className="mt-3"
          disabled={verify.pending}
          onClick={() => verify.run(() => verifyLabOrderAction({ orderId: order.id }), "Results verified.")}
        >
          {verify.pending ? "Verifying…" : "Verify results"}
        </Button>
      ) : null}

      {canCancel && (order.status === "ORDERED" || order.status === "COLLECTED") ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-3 ml-2"
          disabled={cancel.pending}
          onClick={() => cancel.run(() => cancelLabOrderAction({ orderId: order.id }), "Request cancelled.")}
        >
          {cancel.pending ? "Cancelling…" : "Cancel request"}
        </Button>
      ) : null}
    </li>
  );
}
