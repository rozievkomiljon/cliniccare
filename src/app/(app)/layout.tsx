import { redirect } from "next/navigation";

import { AppSidebar } from "@/features/dashboard/components/app-sidebar";
import { getSession } from "@/lib/rbac/guard";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const isSuperAdmin = session.user.isSuperAdmin;
  const role = session.activeRole;

  const navGroups = getNavForRole(role, isSuperAdmin);

  return (
    <div className="flex min-h-screen">
      <AppSidebar items={navGroups} clinicName={session.activeClinicName ?? "ClinicCare"} role={role} />
      <main className="flex-1 p-6 lg:p-8">{children}</main>
    </div>
  );
}

function getNavForRole(role: string, isSuperAdmin: boolean) {
  if (isSuperAdmin) {
    return [
      {
        label: "Platform",
        items: [
          { href: "/admin/clinics", label: "Clinics", enabled: true },
          { href: "/dashboard", label: "Dashboard", enabled: true },
        ],
      },
    ];
  }
  switch (role) {
    case "CLINIC_ADMIN":
      return [
        {
          label: "Clinic",
          items: [
            { href: "/dashboard", label: "Dashboard", enabled: true },
            { href: "/patients", label: "Patients", enabled: true },
            { href: "/appointments", label: "Appointments", enabled: true },
            { href: "/doctors", label: "Doctors", enabled: true },
            { href: "/notifications", label: "Notifications", enabled: true },
            { href: "/settings/staff", label: "Staff", enabled: true },
            { href: "/settings/audit", label: "Audit log", enabled: true },
          ],
        },
      ];
    case "RECEPTIONIST":
      return [
        {
          label: "Front desk",
          items: [
            { href: "/dashboard", label: "Dashboard", enabled: true },
            { href: "/patients", label: "Patients", enabled: true },
            { href: "/appointments", label: "Appointments", enabled: true },
            { href: "/doctors", label: "Doctors", enabled: true },
            { href: "/notifications", label: "Notifications", enabled: true },
            { href: "/settings/staff", label: "Staff directory", enabled: true },
          ],
        },
      ];
    case "DOCTOR":
    case "NURSE":
      return [
        {
          label: "Care",
          items: [
            { href: "/dashboard", label: "Dashboard", enabled: true },
            { href: "/patients", label: "Patients", enabled: true },
            { href: "/appointments", label: "Appointments", enabled: true },
            { href: "/doctors", label: "Doctors", enabled: true },
            { href: "/notifications", label: "Notifications", enabled: true },
          ],
        },
      ];
    case "LAB_TECH":
      return [
        {
          label: "Laboratory",
          items: [
            { href: "/dashboard", label: "Dashboard", enabled: true },
            { href: "/laboratory", label: "Lab queue", enabled: true },
          ],
        },
      ];
    case "PHARMACIST":
      return [
        {
          label: "Pharmacy",
          items: [
            { href: "/dashboard", label: "Dashboard", enabled: true },
            { href: "/pharmacy", label: "Inventory", enabled: true },
          ],
        },
      ];
    case "ACCOUNTANT":
      return [
        {
          label: "Finance",
          items: [
            { href: "/dashboard", label: "Dashboard", enabled: true },
            { href: "/billing", label: "Billing", enabled: true },
          ],
        },
      ];
    default:
      return [
        {
          label: "Menu",
          items: [
            { href: "/dashboard", label: "Dashboard", enabled: true },
            { href: "/notifications", label: "Notifications", enabled: true },
          ],
        },
      ];
  }
}
