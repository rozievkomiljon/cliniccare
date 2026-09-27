"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createPatientAction } from "@/features/patients/actions";
import { BLOOD_GROUPS, SEXES } from "@/features/patients/schemas";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const labelCls = "block text-sm font-medium";
const inputCls = "mt-1 w-full";

function field(label: string, name: string, required = false, type = "text") {
  return (
    <div>
      <Label htmlFor={name} className={labelCls}>
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {/* aria-label gives an exact accessible name (visual asterisk excluded). */}
      <Input id={name} name={name} type={type} required={required} aria-label={label} className={inputCls} />
    </div>
  );
}

export function RegisterPatientForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>Register patient</Button>
    );
  }

  return (
    <form
      className="w-full max-w-2xl rounded-xl border bg-white p-6 shadow-sm dark:bg-zinc-900"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const payload = {
            firstName: String(form.get("firstName") ?? ""),
            lastName: String(form.get("lastName") ?? ""),
            dateOfBirth: String(form.get("dateOfBirth") ?? ""),
            sex: String(form.get("sex") ?? ""),
            phone: String(form.get("phone") ?? ""),
            email: String(form.get("email") ?? ""),
            address: String(form.get("address") ?? ""),
            city: String(form.get("city") ?? ""),
            emergencyContactName: String(form.get("emergencyContactName") ?? ""),
            emergencyContactPhone: String(form.get("emergencyContactPhone") ?? ""),
            bloodGroup: String(form.get("bloodGroup") ?? "") || undefined,
            allergies: String(form.get("allergies") ?? ""),
            chronicConditions: String(form.get("chronicConditions") ?? ""),
            notes: String(form.get("notes") ?? ""),
          };
          const result = await createPatientAction(payload);
          if (result.ok) {
            setOpen(false);
            router.push(`/patients/${result.data.id}`);
            router.refresh();
          } else {
            setError(result.error);
          }
        });
      }}
    >
      <h2 className="text-lg font-semibold">Register patient</h2>
      {error ? (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {field("First name", "firstName", true)}
        {field("Last name", "lastName", true)}
        {field("Date of birth", "dateOfBirth", true, "date")}
        <div>
          <Label htmlFor="sex" className={labelCls}>
            Sex<span className="text-red-600"> *</span>
          </Label>
          <select id="sex" name="sex" required aria-label="Sex" className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm">
            {SEXES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
        {field("Phone", "phone", true, "tel")}
        {field("Email", "email", false, "email")}
        {field("Address", "address")}
        {field("City", "city")}
        {field("Emergency contact", "emergencyContactName")}
        {field("Emergency phone", "emergencyContactPhone", false, "tel")}
        <div>
          <Label htmlFor="bloodGroup" className={labelCls}>
            Blood group
          </Label>
          <select id="bloodGroup" name="bloodGroup" className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm">
            <option value="">Unknown</option>
            {BLOOD_GROUPS.map((b) => (
              <option key={b} value={b}>
                {b.replaceAll("_", b === "UNKNOWN" ? " " : " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="allergies" className={labelCls}>
            Allergies
          </Label>
          <Input id="allergies" name="allergies" className={inputCls} placeholder="Penicillin, latex…" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="chronicConditions" className={labelCls}>
            Chronic conditions
          </Label>
          <Input id="chronicConditions" name="chronicConditions" className={inputCls} placeholder="Diabetes, hypertension…" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="notes" className={labelCls}>
            Notes
          </Label>
          <Input id="notes" name="notes" className={inputCls} />
        </div>
      </div>

      <div className="mt-6 flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Registering…" : "Register"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
