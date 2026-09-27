import { requirePagePermission } from "@/lib/rbac/page-guard";
import { listStaff } from "@/features/staff/queries";
import { StaffTable } from "@/features/staff/components/staff-table";

export const metadata = { title: "Staff" };

export default async function StaffPage() {
  const session = await requirePagePermission("staff:manage");
  const staff = await listStaff(session.activeClinicId ?? "");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Invite staff and manage roles for {session.activeClinicName}.
        </p>
      </header>

      <StaffTable
        staff={staff}
        canManage={session.activeRole === "CLINIC_ADMIN" || session.user.isSuperAdmin}
      />
    </div>
  );
}
