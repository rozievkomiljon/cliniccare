"use server";

/**
 * Appointment Server Actions, two flows:
 *  - staff (appointments:manage): book/reschedule/cancel/status for any
 *    patient of the active clinic;
 *  - portal (appointments:own): patients book/reschedule/cancel strictly their
 *    own appointments — the service layer re-checks ownership by patientId.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  appointmentStatusActionSchema,
  cancelAppointmentSchema,
  createAppointmentSchema,
  rescheduleAppointmentSchema,
} from "@/features/appointments/schemas";
import {
  bookAppointment,
  cancelAppointment,
  rescheduleAppointment,
  setAppointmentStatus,
  type AppointmentActor,
  type AppointmentDto,
} from "@/features/appointments/service";
import { withAction } from "@/lib/actions";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { requirePermission } from "@/lib/rbac/guard";
import { hasPermission } from "@/lib/rbac/permissions";

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

function staffActor(clinicId: string, userId: string, name: string): AppointmentActor {
  return { clinicId, actorUserId: userId, actorName: name, kind: "STAFF" };
}

/** Portal context: the signed-in user's linked patient record. */
async function portalPatient(userId: string) {
  const account = await db.patientAccount.findUnique({
    where: { userId },
    include: { patient: { select: { id: true, clinicId: true } } },
  });
  if (!account) throw new ForbiddenError("Your portal account is not linked to a patient record.");
  return account.patient;
}

async function requirePortalPatient() {
  const session = await requirePermission("appointments:own");
  if (hasPermission(session.activeRole, "appointments:manage")) {
    throw new ForbiddenError("Staff book appointments through the front desk.");
  }
  const patient = await portalPatient(session.user.id);
  return { session, patient };
}

// ---------------------------------------------------------------------------
// Staff flow
// ---------------------------------------------------------------------------

export const createAppointmentAction = withAction(
  createAppointmentSchema,
  async (input): Promise<AppointmentDto> => {
    const session = await requirePermission("appointments:manage");
    const dto = await bookAppointment(
      {
        doctorId: input.doctorId,
        patientId: input.patientId,
        scheduledAt: input.scheduledAt,
        durationMinutes: input.durationMinutes,
        reason: input.reason,
      },
      staffActor(session.activeClinicId ?? "", session.user.id, session.user.name),
    );
    revalidatePath("/appointments");
    revalidatePath("/portal");
    return dto;
  },
);

export const rescheduleAppointmentAction = withAction(
  rescheduleAppointmentSchema,
  async (input): Promise<AppointmentDto> => {
    const session = await requirePermission("appointments:manage");
    const dto = await rescheduleAppointment({
      appointmentId: input.appointmentId,
      scheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes,
      actor: staffActor(session.activeClinicId ?? "", session.user.id, session.user.name),
    });
    revalidatePath("/appointments");
    revalidatePath("/portal");
    return dto;
  },
);

export const cancelAppointmentAction = withAction(
  cancelAppointmentSchema,
  async (input): Promise<AppointmentDto> => {
    const session = await requirePermission("appointments:manage");
    const dto = await cancelAppointment({
      appointmentId: input.appointmentId,
      reason: input.reason,
      actor: staffActor(session.activeClinicId ?? "", session.user.id, session.user.name),
    });
    revalidatePath("/appointments");
    revalidatePath("/portal");
    return dto;
  },
);

export const setAppointmentStatusAction = withAction(
  appointmentStatusActionSchema,
  async (input): Promise<AppointmentDto> => {
    const session = await requirePermission("appointments:manage");
    const dto = await setAppointmentStatus({
      appointmentId: input.appointmentId,
      status: input.status,
      actor: staffActor(session.activeClinicId ?? "", session.user.id, session.user.name),
    });
    revalidatePath("/appointments");
    return dto;
  },
);

// ---------------------------------------------------------------------------
// Portal flow (patients act only on their own record)
// ---------------------------------------------------------------------------

const patientBookSchema = z.object({
  doctorId: z.string().min(1),
  scheduledAt: localDateTime,
  reason: z
    .string()
    .trim()
    .max(300)
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
});

export const patientBookAppointmentAction = withAction(
  patientBookSchema,
  async (input): Promise<AppointmentDto> => {
    const { session, patient } = await requirePortalPatient();
    const dto = await bookAppointment(
      {
        doctorId: input.doctorId,
        patientId: patient.id,
        scheduledAt: input.scheduledAt,
        durationMinutes: 30,
        reason: input.reason,
      },
      {
        clinicId: patient.clinicId,
        actorUserId: session.user.id,
        actorName: session.user.name,
        kind: "PATIENT",
      },
    );
    revalidatePath("/portal");
    revalidatePath("/appointments");
    return dto;
  },
);

const patientRescheduleSchema = z.object({
  appointmentId: z.string().min(1),
  scheduledAt: localDateTime,
});

export const patientRescheduleAppointmentAction = withAction(
  patientRescheduleSchema,
  async (input): Promise<AppointmentDto> => {
    const { session, patient } = await requirePortalPatient();
    const dto = await rescheduleAppointment({
      appointmentId: input.appointmentId,
      scheduledAt: input.scheduledAt,
      actor: {
        clinicId: session.activeClinicId ?? "",
        actorUserId: session.user.id,
        actorName: session.user.name,
        kind: "PATIENT",
      },
      patientId: patient.id,
    });
    revalidatePath("/portal");
    revalidatePath("/appointments");
    return dto;
  },
);

export const patientCancelAppointmentAction = withAction(
  cancelAppointmentSchema,
  async (input): Promise<AppointmentDto> => {
    const { session, patient } = await requirePortalPatient();
    const dto = await cancelAppointment({
      appointmentId: input.appointmentId,
      reason: input.reason,
      actor: {
        clinicId: session.activeClinicId ?? "",
        actorUserId: session.user.id,
        actorName: session.user.name,
        kind: "PATIENT",
      },
      patientId: patient.id,
    });
    revalidatePath("/portal");
    revalidatePath("/appointments");
    return dto;
  },
);
