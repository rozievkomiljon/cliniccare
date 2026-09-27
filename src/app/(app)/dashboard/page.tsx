import { redirect } from "next/navigation";

import { getSession } from "@/lib/rbac/guard";
import { hasPermission } from "@/lib/rbac/permissions";
import { DashboardCard } from "@/features/dashboard/components/dashboard-card";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const role = session.activeRole;
  const cards = buildCards(role, session.user.isSuperAdmin);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting(role)} — {session.activeClinicName ?? "ClinicCare"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Signed in as {session.user.email} · role{" "}
          <span className="font-medium">{role.replaceAll("_", " ").toLowerCase()}</span>
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <DashboardCard key={card.title} title={card.title} description={card.description} />
        ))}
      </div>

      {hasPermission(role, "audit:view") ? (
        <p className="text-xs text-muted-foreground">
          Audit log is available under Settings → Audit log.
        </p>
      ) : null}
    </div>
  );
}

function greeting(role: string): string {
  switch (role) {
    case "SUPER_ADMIN":
      return "Platform administration";
    case "CLINIC_ADMIN":
      return "Clinic overview";
    case "RECEPTIONIST":
      return "Front desk";
    case "DOCTOR":
      return "Good day, Doctor";
    case "NURSE":
      return "Care station";
    case "LAB_TECH":
      return "Laboratory";
    case "PHARMACIST":
      return "Pharmacy";
    case "ACCOUNTANT":
      return "Finance";
    default:
      return "Welcome";
  }
}

function buildCards(role: string, isSuperAdmin: boolean) {
  if (isSuperAdmin) {
    return [
      { title: "Clinics", description: "Manage tenant clinics and their admins." },
      { title: "Platform audit", description: "Cross-clinic administrative trail." },
      { title: "Health", description: "Check /api/health for service status." },
    ];
  }
  switch (role) {
    case "CLINIC_ADMIN":
      return [
        { title: "Staff", description: "Invite staff and manage roles." },
        { title: "Patients", description: "Registration and demographics." },
        { title: "Audit log", description: "Review sensitive actions." },
      ];
    case "RECEPTIONIST":
      return [
        { title: "Register patient", description: "Create a new patient record." },
        { title: "Appointments", description: "Book and check in patients." },
        { title: "Payments", description: "Collect and receipt payments." },
      ];
    case "DOCTOR":
      return [
        { title: "My schedule", description: "Today's consultations." },
        { title: "Patients", description: "Clinical records and history." },
        { title: "Lab orders", description: "Order and review results." },
      ];
    case "NURSE":
      return [
        { title: "Vitals queue", description: "Record vitals for checked-in patients." },
        { title: "Patients", description: "View assigned patients." },
        { title: "Lab orders", description: "Assist with ordering." },
      ];
    case "LAB_TECH":
      return [
        { title: "Samples", description: "Track collected samples." },
        { title: "Results", description: "Enter results for review." },
        { title: "Catalog", description: "Manage available tests." },
      ];
    case "PHARMACIST":
      return [
        { title: "Prescriptions", description: "Dispense pending prescriptions." },
        { title: "Inventory", description: "Batches, expiry, and stock." },
        { title: "Alerts", description: "Low stock and expiration warnings." },
      ];
    case "ACCOUNTANT":
      return [
        { title: "Invoices", description: "Issue and track invoices." },
        { title: "Payments", description: "Record and reconcile payments." },
        { title: "Reports", description: "Revenue and receivables." },
      ];
    default:
      return [{ title: "Dashboard", description: "Your clinic at a glance." }];
  }
}
