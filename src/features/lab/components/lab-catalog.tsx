"use client";

import { useState } from "react";

import { deactivateLabTestAction, upsertLabTestAction } from "@/features/lab/actions";
import { Feedback, inputCls, labelCls, useSubmit } from "@/features/lab/components/submit";
import { labSpecimenLabel } from "@/features/lab/format";
import type { LabTestDto } from "@/features/lab/service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SPECIMENS = ["BLOOD", "URINE", "STOOL", "SWAB", "TISSUE", "OTHER"] as const;
const selectCls = "mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm";

/** One entry in the clinic's test catalog. Editing never rewrites past results. */
function LabTestRow({ test, onEdit }: { test: LabTestDto; onEdit: (test: LabTestDto) => void }) {
  const { error, notice, pending, run } = useSubmit();

  return (
    <li className="flex flex-wrap items-start justify-between gap-2 border-b py-2 last:border-b-0">
      <div>
        <p className="font-medium">
          {test.name} <span className="font-mono text-xs text-muted-foreground">{test.code}</span>
          {!test.isActive ? <span className="ml-2 text-xs text-muted-foreground">(retired)</span> : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {test.category} · {labSpecimenLabel(test.specimen)}
          {test.referenceRange ? ` · ref ${test.referenceRange}` : ""}
          {test.turnaroundHours ? ` · ${test.turnaroundHours}h` : ""}
        </p>
        <Feedback error={error} notice={notice} />
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => onEdit(test)}>
          Edit
        </Button>
        {test.isActive ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => deactivateLabTestAction({ testId: test.id }), "Test retired.")}
          >
            {pending ? "Retiring…" : "Retire"}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** Catalog administration: `lab:catalog` holders add, edit and retire tests. */
export function LabCatalog({ tests }: { tests: LabTestDto[] }) {
  const [editing, setEditing] = useState<LabTestDto | null>(null);
  const { error, notice, pending, run } = useSubmit(() => setEditing(null));
  // Remount the form when the edited entry changes so its defaults follow.
  const formKey = editing?.id ?? "new";

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Catalog</h2>

      <form
        key={formKey}
        className="space-y-4 rounded-xl border bg-white p-5 dark:bg-zinc-900"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          run(
            () =>
              upsertLabTestAction({
                testId: editing?.id ?? "",
                code: String(form.get("code") ?? ""),
                name: String(form.get("name") ?? ""),
                category: String(form.get("category") ?? "GENERAL"),
                specimen: String(form.get("specimen") ?? "BLOOD") as never,
                unit: String(form.get("unit") ?? ""),
                referenceRange: String(form.get("referenceRange") ?? ""),
                turnaroundHours: String(form.get("turnaroundHours") ?? ""),
                isActive: String(form.get("isActive") ?? "true") === "true",
              }),
            editing ? "Test updated." : "Test added.",
          );
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{editing ? `Edit ${editing.name}` : "Add a test"}</h3>
          {editing ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
              New test instead
            </Button>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="catalog-code" className={labelCls}>
              Code
            </Label>
            <Input
              id="catalog-code"
              name="code"
              aria-label="Test code"
              required
              defaultValue={editing?.code ?? ""}
              placeholder="CBC"
              className={inputCls}
            />
          </div>
          <div>
            <Label htmlFor="catalog-name" className={labelCls}>
              Name
            </Label>
            <Input
              id="catalog-name"
              name="name"
              aria-label="Test name"
              required
              defaultValue={editing?.name ?? ""}
              placeholder="Complete blood count"
              className={inputCls}
            />
          </div>
          <div>
            <Label htmlFor="catalog-category" className={labelCls}>
              Category
            </Label>
            <Input
              id="catalog-category"
              name="category"
              aria-label="Test category"
              defaultValue={editing?.category ?? "GENERAL"}
              className={inputCls}
            />
          </div>
          <div>
            <Label htmlFor="catalog-specimen" className={labelCls}>
              Specimen
            </Label>
            <select
              id="catalog-specimen"
              name="specimen"
              aria-label="Specimen type"
              defaultValue={editing?.specimen ?? "BLOOD"}
              className={selectCls}
            >
              {SPECIMENS.map((specimen) => (
                <option key={specimen} value={specimen}>
                  {labSpecimenLabel(specimen)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="catalog-unit" className={labelCls}>
              Unit
            </Label>
            <Input id="catalog-unit" name="unit" aria-label="Result unit" defaultValue={editing?.unit ?? ""} className={inputCls} />
          </div>
          <div>
            <Label htmlFor="catalog-range" className={labelCls}>
              Reference range
            </Label>
            <Input
              id="catalog-range"
              name="referenceRange"
              aria-label="Reference range"
              defaultValue={editing?.referenceRange ?? ""}
              placeholder="4.0-11.0"
              className={inputCls}
            />
          </div>
          <div>
            <Label htmlFor="catalog-tat" className={labelCls}>
              Turnaround (hours)
            </Label>
            <Input
              id="catalog-tat"
              name="turnaroundHours"
              aria-label="Turnaround hours"
              type="number"
              min={1}
              defaultValue={editing?.turnaroundHours ?? ""}
              className={inputCls}
            />
          </div>
          <div>
            <Label htmlFor="catalog-active" className={labelCls}>
              Availability
            </Label>
            <select
              id="catalog-active"
              name="isActive"
              aria-label="Availability"
              defaultValue={String(editing?.isActive ?? true)}
              className={selectCls}
            >
              <option value="true">orderable</option>
              <option value="false">retired</option>
            </select>
          </div>
        </div>

        <Feedback error={error} notice={notice} />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save test" : "Add test"}
        </Button>
      </form>

      <div className="rounded-xl border bg-white p-5 text-sm dark:bg-zinc-900">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {tests.length} test{tests.length === 1 ? "" : "s"}
        </h3>
        {tests.length === 0 ? (
          <p className="text-muted-foreground">No tests in the catalog yet.</p>
        ) : (
          <ul>
            {tests.map((test) => (
              <LabTestRow key={test.id} test={test} onEdit={setEditing} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
