"use client";

import { useState, useTransition } from "react";

import { createStaffAction, deactivateStaffAction, updateStaffRoleAction } from "@/features/staff/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type StaffRow = {
  userId: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
};

const ROLES = [
  "CLINIC_ADMIN",
  "RECEPTIONIST",
  "DOCTOR",
  "NURSE",
  "LAB_TECH",
  "PHARMACIST",
  "ACCOUNTANT",
] as const;

export function StaffTable({ staff, canManage }: { staff: StaffRow[]; canManage: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok && result.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {canManage ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const role = String(form.get("role") ?? "");
            run(async () => {
              const result = await createStaffAction({
                name: String(form.get("name") ?? ""),
                email: String(form.get("email") ?? ""),
                role,
              });
              if (result.ok) setNotice("Invitation sent.");
              return result;
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required className="w-48" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required className="w-56" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role">Role</Label>
            <select
              id="role"
              name="role"
              className="h-9 rounded-md border bg-transparent px-3 text-sm"
              defaultValue="RECEPTIONIST"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={pending}>
            Invite
          </Button>
        </form>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            {canManage ? <TableHead className="w-24">Actions</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {staff.map((s) => (
            <TableRow key={`${s.userId}`}>
              <TableCell>{s.name}</TableCell>
              <TableCell>{s.email}</TableCell>
              <TableCell>
                {canManage ? (
                  <select
                    className="h-8 rounded-md border bg-transparent px-2 text-sm"
                    value={s.role}
                    disabled={pending}
                    onChange={(event) => {
                      const role = event.target.value;
                      run(async () => {
                        const result = await updateStaffRoleAction({ userId: s.userId, role });
                        if (result.ok) setNotice("Role updated.");
                        return result;
                      });
                    }}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                ) : (
                  s.role.replaceAll("_", " ")
                )}
              </TableCell>
              <TableCell>{s.isActive ? "Active" : "Disabled"}</TableCell>
              {canManage ? (
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        const result = await deactivateStaffAction({ userId: s.userId });
                        if (result.ok) setNotice("Membership removed.");
                        return result;
                      })
                    }
                  >
                    Remove
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
