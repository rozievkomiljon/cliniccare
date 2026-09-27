import Link from "next/link";
import { Suspense } from "react";

import { PatientSearch } from "@/features/patients/components/patient-search";
import { RegisterPatientForm } from "@/features/patients/components/register-patient-dialog";
import { listPatients } from "@/features/patients/queries";
import { Button } from "@/components/ui/button";
import { requirePagePermission } from "@/lib/rbac/page-guard";

export const metadata = { title: "Patients" };

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const session = await requirePagePermission("patients:view");
  const { q, page } = await searchParams;
  const data = await listPatients(session.activeClinicId ?? "", {
    query: q,
    page: page ? Number(page) : 1,
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Patients</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.total} patient(s) at {session.activeClinicName}
          </p>
        </div>
        {session.activeRole === "RECEPTIONIST" ||
        session.activeRole === "CLINIC_ADMIN" ||
        session.activeRole === "SUPER_ADMIN" ||
        session.user.isSuperAdmin ? (
          <RegisterPatientForm />
        ) : (
          <Button disabled title="Your role cannot register patients">
            Register patient
          </Button>
        )}
      </header>

      <Suspense fallback={null}>
        <PatientSearch />
      </Suspense>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">MRN</th>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">DOB</th>
              <th className="px-4 py-2 font-medium">Sex</th>
              <th className="px-4 py-2 font-medium">Phone</th>
              <th className="px-4 py-2 font-medium">City</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((p) => (
              <tr key={p.id} className="border-t hover:bg-muted/40">
                <td className="px-4 py-2 font-mono text-xs">{p.mrn}</td>
                <td className="px-4 py-2">
                  <Link href={`/patients/${p.id}`} className="font-medium text-teal-700 hover:underline dark:text-teal-400">
                    {p.lastName}, {p.firstName}
                  </Link>
                </td>
                <td className="px-4 py-2">{p.dateOfBirth}</td>
                <td className="px-4 py-2">{p.sex.replaceAll("_", " ")}</td>
                <td className="px-4 py-2">{p.phone}</td>
                <td className="px-4 py-2">{p.city}</td>
              </tr>
            ))}
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {q ? `No patients match “${q}”.` : "No patients registered yet."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {data.pageCount > 1 ? (
        <div className="flex items-center gap-2 text-sm">
          {data.page > 1 ? (
            <Link
              href={`/patients?${new URLSearchParams({ ...(q ? { q } : {}), page: String(data.page - 1) }).toString()}`}
              className="rounded-md border px-3 py-1.5 hover:bg-muted"
            >
              ← Previous
            </Link>
          ) : null}
          <span className="text-muted-foreground">
            Page {data.page} of {data.pageCount}
          </span>
          {data.page < data.pageCount ? (
            <Link
              href={`/patients?${new URLSearchParams({ ...(q ? { q } : {}), page: String(data.page + 1) }).toString()}`}
              className="rounded-md border px-3 py-1.5 hover:bg-muted"
            >
              Next →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
