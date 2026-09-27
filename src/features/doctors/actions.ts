"use server";

/**
 * Doctor Server Actions. schedule:manage guards profile/schedule writes;
 * the doctor directory is read through queries + schedule:view pages.
 */
import { revalidatePath } from "next/cache";

import {
  addTimeOffSchema,
  removeTimeOffSchema,
  upsertDoctorProfileSchema,
  upsertDoctorScheduleSchema,
} from "@/features/doctors/schemas";
import {
  addDoctorTimeOff,
  removeDoctorTimeOff,
  upsertDoctorProfile,
  upsertDoctorSchedule,
  type DoctorDto,
  type DoctorTimeOffDto,
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

export const addDoctorTimeOffAction = withAction(
  addTimeOffSchema,
  async (input): Promise<DoctorTimeOffDto> => {
    const session = await requirePermission("schedule:manage");
    const timeOff = await addDoctorTimeOff({
      clinicId: session.activeClinicId ?? "",
      actorUserId: session.user.id,
      doctorId: input.doctorId,
      date: input.date,
      startTime: input.startTime || undefined,
      endTime: input.endTime || undefined,
      isFullDay: input.isFullDay,
      reason: input.reason,
    });
    revalidatePath("/doctors");
    revalidatePath("/appointments");
    return timeOff;
  },
);

export const removeDoctorTimeOffAction = withAction(
  removeTimeOffSchema,
  async (input): Promise<{ removed: true }> => {
    const session = await requirePermission("schedule:manage");
    await removeDoctorTimeOff({
      clinicId: session.activeClinicId ?? "",
      actorUserId: session.user.id,
      timeOffId: input.timeOffId,
    });
    revalidatePath("/doctors");
    revalidatePath("/appointments");
    return { removed: true };
  },
);
