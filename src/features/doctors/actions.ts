"use server";

/**
 * Doctor Server Actions. schedule:manage guards profile/schedule writes;
 * the doctor directory is read through queries + schedule:view pages.
 */
import { revalidatePath } from "next/cache";

import { upsertDoctorProfileSchema, upsertDoctorScheduleSchema } from "@/features/doctors/schemas";
import {
  upsertDoctorProfile,
  upsertDoctorSchedule,
  type DoctorDto,
} from "@/features/doctors/service";
import { withAction } from "@/lib/actions";
import { requirePermission } from "@/lib/rbac/guard";

export const upsertDoctorProfileAction = withAction(
  upsertDoctorProfileSchema,
  async (input): Promise<DoctorDto> => {
    const session = await requirePermission("schedule:manage");
    const doctor = await upsertDoctorProfile({
      ...input,
      clinicId: session.activeClinicId ?? "",
      actorUserId: session.user.id,
    });
    revalidatePath("/doctors");
    return doctor;
  },
);

export const upsertDoctorScheduleAction = withAction(
  upsertDoctorScheduleSchema,
  async (input): Promise<{ updated: true }> => {
    const session = await requirePermission("schedule:manage");
    await upsertDoctorSchedule({
      doctorId: input.doctorId,
      rows: input.rows,
      clinicId: session.activeClinicId ?? "",
      actorUserId: session.user.id,
    });
    revalidatePath("/doctors");
    revalidatePath("/appointments");
    return { updated: true };
  },
);
