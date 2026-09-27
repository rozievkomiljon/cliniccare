/**
 * Phase 3 integration tests (Postgres-backed): the double-booking race, the
 * availability rule set, clinic isolation and the audit/notification trail.
 *
 * The race test is the point: two parallel bookings of the same slot must end
 * with exactly one active appointment — via the service overlap check OR the
 * partial unique index, whichever wins the commit race.
 */
import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { hashPassword } from "@/lib/auth/password";
import {
  bookAppointment,
  cancelAppointment,
  rescheduleAppointment,
  setAppointmentStatus,
  type AppointmentActor,
} from "@/features/appointments/service";
import {
  addDoctorTimeOff,
  removeDoctorTimeOff,
  upsertDoctorProfile,
  upsertDoctorSchedule,
} from "@/features/doctors/service";

const DB_AVAILABLE = await (async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
})();
const CI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const hasDb = DB_AVAILABLE || CI;

const suffix = process.env.GITHUB_RUN_ID ?? "local";
const CLINIC_A = `p3-a-${suffix}`;
const CLINIC_B = `p3-b-${suffix}`;
/** Non-UTC clinic: proves scheduling reads wall clock, not UTC. */
const CLINIC_C = `p3-c-${suffix}`;
const EMAIL_DOMAIN = "@ap3test.local";

async function ensureClinic(slug: string) {
  return db.clinic.upsert({
    where: { slug },
    update: {},
    create: { name: `P3 ${slug}`, slug, timezone: "UTC" },
  });
}

/** Same as ensureClinic but with an explicit IANA timezone. */
async function ensureClinicWithZone(slug: string, timezone: string) {
  return db.clinic.upsert({
    where: { slug },
    update: { timezone },
    create: { name: `P3 ${slug}`, slug, timezone },
  });
}

/** Idempotent role grant (memberships are unique per user+clinic). */
async function makeMembership(userId: string, clinicId: string, role: "DOCTOR" | "NURSE" | "CLINIC_ADMIN") {
  return db.membership.upsert({
    where: { userId_clinicId: { userId, clinicId } },
    update: { role },
    create: { userId, clinicId, role },
  });
}

async function makeStaffUser(email: string, name = "P3 Staff") {
  return db.user.upsert({
    where: { email },
    update: {},
    create: { email, name, passwordHash: await hashPassword("Sup3r$ecret!pw") },
  });
}

/** Monday 10:00 next week (UTC) — far enough to be stable across runs. */
function nextMondayAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setUTCHours(hour, minute, 0, 0);
  const add = (8 - d.getUTCDay()) % 7 || 7; // days until next Monday
  d.setUTCDate(d.getUTCDate() + add);
  return d;
}

const iso = (d: Date) => d.toISOString().slice(0, 16);

describe.skipIf(!hasDb)("appointment booking", () => {
  it("rejects bookings outside the doctor's weekly hours", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const staff = await makeStaffUser(`s1-${suffix}${EMAIL_DOMAIN}`);
    const doctorUser = await makeStaffUser(`d1-${suffix}${EMAIL_DOMAIN}`, "Dr Hours");
    const doctor = await db.doctorProfile.create({
      data: {
        userId: doctorUser.id,
        clinicId: clinic.id,
        specialization: "Testology",
        schedules: { create: { weekday: 1, startMinute: 540, endMinute: 1020, slotMinutes: 30 } },
      },
    });

    // Monday 08:00 is before the 09:00 shift start.
    await expect(
      bookAppointment(
        {
          doctorId: doctor.id,
          patientId: (await db.patient.create({
            data: {
              clinicId: clinic.id,
              mrn: `P3-${Date.now()}-1`,
              firstName: "Early",
              lastName: "Bird",
              dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
              sex: "MALE",
              phone: "+1 555 030 0001",
            },
          })).id,
          scheduledAt: iso(nextMondayAt(8)),
          durationMinutes: 30,
        },
        { clinicId: clinic.id, actorUserId: staff.id, actorName: staff.name, kind: "STAFF" },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects bookings on days without a schedule", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const staff = await makeStaffUser(`s2-${suffix}${EMAIL_DOMAIN}`);
    const doctorUser = await makeStaffUser(`d2-${suffix}${EMAIL_DOMAIN}`, "Dr Monday");
    const doctor = await db.doctorProfile.create({
      data: {
        userId: doctorUser.id,
        clinicId: clinic.id,
        specialization: "Testology",
        schedules: { create: { weekday: 1, startMinute: 540, endMinute: 1020, slotMinutes: 30 } },
      },
    });
    const patient = await db.patient.create({
      data: {
        clinicId: clinic.id,
        mrn: `P3-${Date.now()}-2`,
        firstName: "Tuesday",
        lastName: "Try",
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        sex: "FEMALE",
        phone: "+1 555 030 0002",
      },
    });

    await expect(
      bookAppointment(
        {
          doctorId: doctor.id,
          patientId: patient.id,
          scheduledAt: iso(new Date(nextMondayAt(10).getTime() + 24 * 3600 * 1000)), // next day: Tuesday
          durationMinutes: 30,
        },
        { clinicId: clinic.id, actorUserId: staff.id, actorName: staff.name, kind: "STAFF" },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects an overlapping (but not identical) active booking", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const staff = await makeStaffUser(`s3-${suffix}${EMAIL_DOMAIN}`);
    const doctorUser = await makeStaffUser(`d3-${suffix}${EMAIL_DOMAIN}`, "Dr Overlap");
    const doctor = await db.doctorProfile.create({
      data: {
        userId: doctorUser.id,
        clinicId: clinic.id,
        specialization: "Testology",
        schedules: { create: { weekday: 1, startMinute: 540, endMinute: 1020, slotMinutes: 30 } },
      },
    });
    const mkPatient = async (n: number) =>
      db.patient.create({
        data: {
          clinicId: clinic.id,
          mrn: `P3-${Date.now()}-o${n}`,
          firstName: `Overlap${n}`,
          lastName: "Case",
          dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
          sex: "OTHER",
          phone: `+1 555 030 10${n}`,
        },
      });

    const actor: AppointmentActor = { clinicId: clinic.id, actorUserId: staff.id, actorName: staff.name, kind: "STAFF" };
    const base = nextMondayAt(10);

    await bookAppointment(
      { doctorId: doctor.id, patientId: (await mkPatient(1)).id, scheduledAt: iso(base), durationMinutes: 30 },
      actor,
    );

    // 10:15 overlaps the 10:00–10:30 visit but shares no exact timestamp.
    await expect(
      bookAppointment(
        { doctorId: doctor.id, patientId: (await mkPatient(2)).id, scheduledAt: iso(new Date(base.getTime() + 15 * 60_000)), durationMinutes: 30 },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("double-booking race: exactly one of two parallel bookings wins", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const staff = await makeStaffUser(`s4-${suffix}${EMAIL_DOMAIN}`);
    const doctorUser = await makeStaffUser(`d4-${suffix}${EMAIL_DOMAIN}`, "Dr Race");
    const doctor = await db.doctorProfile.create({
      data: {
        userId: doctorUser.id,
        clinicId: clinic.id,
        specialization: "Testology",
        schedules: { create: { weekday: 1, startMinute: 540, endMinute: 1020, slotMinutes: 30 } },
      },
    });
    const patientA = await db.patient.create({
      data: {
        clinicId: clinic.id,
        mrn: `P3-${Date.now()}-ra`,
        firstName: "Racer",
        lastName: "One",
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        sex: "MALE",
        phone: "+1 555 030 0021",
      },
    });
    const patientB = await db.patient.create({
      data: {
        clinicId: clinic.id,
        mrn: `P3-${Date.now()}-rb`,
        firstName: "Racer",
        lastName: "Two",
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        sex: "FEMALE",
        phone: "+1 555 030 0022",
      },
    });

    const actor: AppointmentActor = { clinicId: clinic.id, actorUserId: staff.id, actorName: staff.name, kind: "STAFF" };
    const slot = iso(nextMondayAt(11));

    const results = await Promise.allSettled([
      bookAppointment({ doctorId: doctor.id, patientId: patientA.id, scheduledAt: slot, durationMinutes: 30 }, actor),
      bookAppointment({ doctorId: doctor.id, patientId: patientB.id, scheduledAt: slot, durationMinutes: 30 }, actor),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

    // Exactly one ACTIVE appointment occupies the slot (either patient).
    const actives = await db.appointment.findMany({
      where: {
        doctorId: doctor.id,
        scheduledAt: new Date(`${slot}:00.000Z`),
        status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"] },
      },
    });
    expect(actives).toHaveLength(1);

    // And the DB guard itself is present (belt over braces).
    const indexes = await db.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'Appointment' AND indexname = 'Appointment_active_doctor_slot_key'`;
    expect(indexes).toHaveLength(1);
  });

  it("cancelled slots free up and can be rebooked", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const staff = await makeStaffUser(`s5-${suffix}${EMAIL_DOMAIN}`);
    const doctorUser = await makeStaffUser(`d5-${suffix}${EMAIL_DOMAIN}`, "Dr Rebook");
    const doctor = await db.doctorProfile.create({
      data: {
        userId: doctorUser.id,
        clinicId: clinic.id,
        specialization: "Testology",
        schedules: { create: { weekday: 1, startMinute: 540, endMinute: 1020, slotMinutes: 30 } },
      },
    });
    const patient = await db.patient.create({
      data: {
        clinicId: clinic.id,
        mrn: `P3-${Date.now()}-3`,
        firstName: "Re",
        lastName: "Book",
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        sex: "MALE",
        phone: "+1 555 030 0003",
      },
    });
    const actor: AppointmentActor = { clinicId: clinic.id, actorUserId: staff.id, actorName: staff.name, kind: "STAFF" };
    const slot = iso(nextMondayAt(12));

    const first = await bookAppointment({ doctorId: doctor.id, patientId: patient.id, scheduledAt: slot, durationMinutes: 30 }, actor);
    await cancelAppointment({ appointmentId: first.id, reason: "Cannot make it", actor });

    const second = await bookAppointment({ doctorId: doctor.id, patientId: patient.id, scheduledAt: slot, durationMinutes: 30 }, actor);
    expect(second.status).toBe("PENDING");
  });

  it("reschedule validates availability and records the move", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const staff = await makeStaffUser(`s6-${suffix}${EMAIL_DOMAIN}`);
    const doctorUser = await makeStaffUser(`d6-${suffix}${EMAIL_DOMAIN}`, "Dr Move");
    const doctor = await db.doctorProfile.create({
      data: {
        userId: doctorUser.id,
        clinicId: clinic.id,
        specialization: "Testology",
        schedules: { create: { weekday: 1, startMinute: 540, endMinute: 1020, slotMinutes: 30 } },
      },
    });
    const patient = await db.patient.create({
      data: {
        clinicId: clinic.id,
        mrn: `P3-${Date.now()}-4`,
        firstName: "Move",
        lastName: "It",
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        sex: "FEMALE",
        phone: "+1 555 030 0004",
      },
    });
    const actor: AppointmentActor = { clinicId: clinic.id, actorUserId: staff.id, actorName: staff.name, kind: "STAFF" };
    const base = nextMondayAt(13);

    const appt = await bookAppointment({ doctorId: doctor.id, patientId: patient.id, scheduledAt: iso(base), durationMinutes: 30 }, actor);

    // Block the 13:30 slot with a second patient, then try to move into it.
    const other = await db.patient.create({
      data: {
        clinicId: clinic.id,
        mrn: `P3-${Date.now()}-5`,
        firstName: "Block",
        lastName: "Slot",
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        sex: "MALE",
        phone: "+1 555 030 0005",
      },
    });
    await bookAppointment(
      { doctorId: doctor.id, patientId: other.id, scheduledAt: iso(new Date(base.getTime() + 30 * 60_000)), durationMinutes: 30 },
      actor,
    );

    await expect(
      rescheduleAppointment(
        { appointmentId: appt.id, scheduledAt: iso(new Date(base.getTime() + 15 * 60_000)), actor },
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    // A legal move succeeds and appends a RESCHEDULED event.
    const moved = await rescheduleAppointment(
      { appointmentId: appt.id, scheduledAt: iso(new Date(base.getTime() + 60 * 60_000)), actor },
    );
    expect(moved.scheduledAt.slice(11, 16)).toBe("14:00");
    const events = await db.appointmentEvent.findMany({ where: { appointmentId: appt.id } });
    expect(events.some((e) => e.type === "RESCHEDULED")).toBe(true);
  });

  it("enforces the status lifecycle", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const staff = await makeStaffUser(`s7-${suffix}${EMAIL_DOMAIN}`);
    const doctorUser = await makeStaffUser(`d7-${suffix}${EMAIL_DOMAIN}`, "Dr Flow");
    const doctor = await db.doctorProfile.create({
      data: {
        userId: doctorUser.id,
        clinicId: clinic.id,
        specialization: "Testology",
        schedules: { create: { weekday: 1, startMinute: 540, endMinute: 1020, slotMinutes: 30 } },
      },
    });
    const patient = await db.patient.create({
      data: {
        clinicId: clinic.id,
        mrn: `P3-${Date.now()}-6`,
        firstName: "Flow",
        lastName: "Case",
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        sex: "OTHER",
        phone: "+1 555 030 0006",
      },
    });
    const actor: AppointmentActor = { clinicId: clinic.id, actorUserId: staff.id, actorName: staff.name, kind: "STAFF" };

    const appt = await bookAppointment(
      { doctorId: doctor.id, patientId: patient.id, scheduledAt: iso(nextMondayAt(15)), durationMinutes: 30 },
      actor,
    );
    await expect(
      setAppointmentStatus({ appointmentId: appt.id, status: "COMPLETED", actor }),
    ).rejects.toBeInstanceOf(ConflictError);

    const confirmed = await setAppointmentStatus({ appointmentId: appt.id, status: "CONFIRMED", actor });
    expect(confirmed.status).toBe("CONFIRMED");
  });

  it("clinic B cannot book or mutate clinic A's appointments", async () => {
    const a = await ensureClinic(CLINIC_A);
    const b = await ensureClinic(CLINIC_B);
    const staffB = await makeStaffUser(`sb-${suffix}${EMAIL_DOMAIN}`);
    const doctorUserA = await makeStaffUser(`d8-${suffix}${EMAIL_DOMAIN}`, "Dr Cross");
    const doctorA = await db.doctorProfile.create({
      data: {
        userId: doctorUserA.id,
        clinicId: a.id,
        specialization: "Testology",
        schedules: { create: { weekday: 1, startMinute: 540, endMinute: 1020, slotMinutes: 30 } },
      },
    });
    const patientA = await db.patient.create({
      data: {
        clinicId: a.id,
        mrn: `P3-${Date.now()}-x`,
        firstName: "Cross",
        lastName: "Tenant",
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        sex: "MALE",
        phone: "+1 555 030 0007",
      },
    });
    const actorB: AppointmentActor = { clinicId: b.id, actorUserId: staffB.id, actorName: staffB.name, kind: "STAFF" };

    // Booking against another clinic's doctor/patient is a NotFound.
    await expect(
      bookAppointment(
        { doctorId: doctorA.id, patientId: patientA.id, scheduledAt: iso(nextMondayAt(16)), durationMinutes: 30 },
        actorB,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Cancelling clinic A's appointment from clinic B is a NotFound.
    const apptA = await db.appointment.create({
      data: {
        clinicId: a.id,
        doctorId: doctorA.id,
        patientId: patientA.id,
        scheduledAt: nextMondayAt(16, 30),
        durationMinutes: 30,
      },
    });
    await expect(
      cancelAppointment({ appointmentId: apptA.id, actor: actorB }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("writes audit rows and notifications transactionally", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const staff = await makeStaffUser(`s8-${suffix}${EMAIL_DOMAIN}`);
    const doctorUser = await makeStaffUser(`d9-${suffix}${EMAIL_DOMAIN}`, "Dr Notify");
    const doctor = await db.doctorProfile.create({
      data: {
        userId: doctorUser.id,
        clinicId: clinic.id,
        specialization: "Testology",
        schedules: { create: { weekday: 1, startMinute: 540, endMinute: 1020, slotMinutes: 30 } },
      },
    });
    const patient = await db.patient.create({
      data: {
        clinicId: clinic.id,
        mrn: `P3-${Date.now()}-7`,
        firstName: "Notified",
        lastName: "Patient",
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        sex: "FEMALE",
        phone: "+1 555 030 0008",
      },
    });
    await db.patientAccount.create({
      data: { userId: (await makeStaffUser(`pa-${suffix}${EMAIL_DOMAIN}`)).id, patientId: patient.id },
    });

    const actor: AppointmentActor = { clinicId: clinic.id, actorUserId: staff.id, actorName: staff.name, kind: "STAFF" };
    const appt = await bookAppointment(
      { doctorId: doctor.id, patientId: patient.id, scheduledAt: iso(nextMondayAt(9, 30)), durationMinutes: 30 },
      actor,
    );

    const audits = await db.auditLog.findMany({ where: { entityType: "Appointment", entityId: appt.id } });
    expect(audits.some((a) => a.action === "appointment.booked")).toBe(true);

    const patientNotifs = await db.notification.findMany({ where: { patientId: patient.id } });
    expect(patientNotifs.some((n) => n.type === "APPOINTMENT_BOOKED")).toBe(true);

    const doctorNotifs = await db.notification.findMany({ where: { userId: doctorUser.id, type: "APPOINTMENT_BOOKED" } });
    expect(doctorNotifs.length).toBeGreaterThan(0);

    await cancelAppointment({ appointmentId: appt.id, reason: "test done", actor });
    const cancelNotifs = await db.notification.findMany({ where: { patientId: patient.id, type: "APPOINTMENT_CANCELLED" } });
    expect(cancelNotifs.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasDb)("doctor schedule service", () => {
  it("replaces the weekly schedule atomically", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const admin = await makeStaffUser(`sa-${suffix}${EMAIL_DOMAIN}`);
    const doctorUser = await makeStaffUser(`ds-${suffix}${EMAIL_DOMAIN}`, "Dr Resched");
    const doctor = await db.doctorProfile.create({
      data: {
        userId: doctorUser.id,
        clinicId: clinic.id,
        specialization: "Testology",
        schedules: { create: { weekday: 1, startMinute: 540, endMinute: 1020, slotMinutes: 30 } },
      },
    });

    await upsertDoctorSchedule({
      clinicId: clinic.id,
      actorUserId: admin.id,
      doctorId: doctor.id,
      rows: [
        { weekday: 2, startMinute: 600, endMinute: 900, slotMinutes: 20 },
        { weekday: 3, startMinute: 600, endMinute: 900, slotMinutes: 20 },
      ],
    });

    const rows = await db.doctorSchedule.findMany({ where: { doctorId: doctor.id, isDeleted: false } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.weekday >= 2)).toBe(true);
    const old = await db.doctorSchedule.findFirst({ where: { doctorId: doctor.id, weekday: 1 } });
    expect(old?.isDeleted).toBe(true);
  });
});

describe.skipIf(!hasDb)("doctor absences, clinic timezone and doctor admin", () => {
  async function mkPatient(clinicId: string, tag: string, firstName = "Absent") {
    return db.patient.create({
      data: {
        clinicId,
        mrn: `P3-${Date.now()}-${tag}`,
        firstName,
        lastName: "Case",
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        sex: "OTHER",
        phone: `+1 555 04${tag}`,
      },
    });
  }

  it("a full-day absence blocks that day only, and removal reopens it", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const staff = await makeStaffUser(`s9-${suffix}${EMAIL_DOMAIN}`);
    const doctorUser = await makeStaffUser(`d10-${suffix}${EMAIL_DOMAIN}`, "Dr Absent");
    const doctor = await db.doctorProfile.create({
      data: {
        userId: doctorUser.id,
        clinicId: clinic.id,
        specialization: "Testology",
        schedules: {
          create: [
            { weekday: 1, startMinute: 540, endMinute: 1020, slotMinutes: 30 },
            { weekday: 2, startMinute: 540, endMinute: 1020, slotMinutes: 30 },
          ],
        },
      },
    });
    const patient = await mkPatient(clinic.id, "1");
    const actor: AppointmentActor = { clinicId: clinic.id, actorUserId: staff.id, actorName: staff.name, kind: "STAFF" };

    const monday = nextMondayAt(10);
    const absent = await addDoctorTimeOff({
      clinicId: clinic.id,
      actorUserId: staff.id,
      doctorId: doctor.id,
      date: monday.toISOString().slice(0, 10),
      isFullDay: true,
      reason: "Conference",
    });
    expect(absent.isFullDay).toBe(true);

    await expect(
      bookAppointment(
        { doctorId: doctor.id, patientId: patient.id, scheduledAt: iso(monday), durationMinutes: 30 },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    // The very next day is unaffected: an absence is a window, not a flag.
    const tuesday = await bookAppointment(
      {
        doctorId: doctor.id,
        patientId: patient.id,
        scheduledAt: iso(new Date(monday.getTime() + 24 * 3600 * 1000)),
        durationMinutes: 30,
      },
      actor,
    );
    expect(tuesday.status).toBe("PENDING");

    const audits = await db.auditLog.findMany({ where: { action: "doctor.timeoff_added", entityId: absent.id } });
    expect(audits).toHaveLength(1);

    await removeDoctorTimeOff({ clinicId: clinic.id, actorUserId: staff.id, timeOffId: absent.id });
    const reopened = await bookAppointment(
      { doctorId: doctor.id, patientId: patient.id, scheduledAt: iso(monday), durationMinutes: 30 },
      actor,
    );
    expect(reopened.status).toBe("PENDING");
  });

  it("a partial absence blocks its window and nothing around it", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const staff = await makeStaffUser(`s10-${suffix}${EMAIL_DOMAIN}`);
    const doctorUser = await makeStaffUser(`d11-${suffix}${EMAIL_DOMAIN}`, "Dr Halfday");
    const doctor = await db.doctorProfile.create({
      data: {
        userId: doctorUser.id,
        clinicId: clinic.id,
        specialization: "Testology",
        schedules: { create: { weekday: 1, startMinute: 540, endMinute: 1020, slotMinutes: 30 } },
      },
    });
    const patient = await mkPatient(clinic.id, "2", "Halfday");
    const actor: AppointmentActor = { clinicId: clinic.id, actorUserId: staff.id, actorName: staff.name, kind: "STAFF" };
    const monday = nextMondayAt(10);

    await addDoctorTimeOff({
      clinicId: clinic.id,
      actorUserId: staff.id,
      doctorId: doctor.id,
      date: monday.toISOString().slice(0, 10),
      isFullDay: false,
      startTime: "09:00",
      endTime: "10:00",
      reason: "Dentist",
    });

    await expect(
      bookAppointment(
        // 09:30 sits inside the absence window but inside working hours.
        { doctorId: doctor.id, patientId: patient.id, scheduledAt: iso(new Date(monday.getTime() - 30 * 60_000)), durationMinutes: 30 },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    // 10:00 is the first free slot after the window.
    const after = await bookAppointment(
      { doctorId: doctor.id, patientId: patient.id, scheduledAt: iso(monday), durationMinutes: 30 },
      actor,
    );
    expect(after.status).toBe("PENDING");
  });

  it("schedules a non-UTC clinic on its own wall clock", async () => {
    const clinic = await ensureClinicWithZone(CLINIC_C, "Europe/Berlin");
    const staff = await makeStaffUser(`sc-${suffix}${EMAIL_DOMAIN}`);
    const doctorUser = await makeStaffUser(`dc-${suffix}${EMAIL_DOMAIN}`, "Dr Berlin");
    const doctor = await db.doctorProfile.create({
      data: {
        userId: doctorUser.id,
        clinicId: clinic.id,
        specialization: "Testology",
        schedules: { create: { weekday: 1, startMinute: 540, endMinute: 1020, slotMinutes: 30 } },
      },
    });
    const patient = await mkPatient(clinic.id, "3", "Berliner");
    const actor: AppointmentActor = { clinicId: clinic.id, actorUserId: staff.id, actorName: staff.name, kind: "STAFF" };

    // 2027-01-04 is a Monday; Berlin is CET (UTC+1) in January.
    const booked = await bookAppointment(
      { doctorId: doctor.id, patientId: patient.id, scheduledAt: "2027-01-04T09:00", durationMinutes: 30 },
      actor,
    );
    expect(booked.scheduledAt).toBe("2027-01-04T08:00:00.000Z");

    // The stored instant would look like working hours in UTC, but 08:00 local
    // is before the 09:00 shift — the rule is evaluated in clinic-local time.
    await expect(
      bookAppointment(
        { doctorId: doctor.id, patientId: patient.id, scheduledAt: "2027-01-04T08:00", durationMinutes: 30 },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const notif = await db.notification.findFirst({
      where: { clinicId: clinic.id, patientId: patient.id, type: "APPOINTMENT_BOOKED" },
    });
    expect(notif?.body).toContain("2027-01-04 09:00 (Europe/Berlin)");
  });

  it("only a doctor-role membership can be given a doctor profile", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const admin = await makeStaffUser(`ad-${suffix}${EMAIL_DOMAIN}`, "Admin Person");
    await makeMembership(admin.id, clinic.id, "CLINIC_ADMIN");

    const nurseUser = await makeStaffUser(`nu-${suffix}${EMAIL_DOMAIN}`, "Nora Notdoctor");
    await makeMembership(nurseUser.id, clinic.id, "NURSE");

    const doctorUser = await makeStaffUser(`dg-${suffix}${EMAIL_DOMAIN}`, "Dr Genuine");
    await makeMembership(doctorUser.id, clinic.id, "DOCTOR");

    await expect(
      upsertDoctorProfile({
        clinicId: clinic.id,
        actorUserId: admin.id,
        userId: nurseUser.id,
        specialization: "Nursing",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const profile = await upsertDoctorProfile({
      clinicId: clinic.id,
      actorUserId: admin.id,
      userId: doctorUser.id,
      specialization: "Cardiology",
      licenseNo: "LIC-TEST-1",
    });
    expect(profile.specialization).toBe("Cardiology");

    const audits = await db.auditLog.findMany({
      where: { entityType: "DoctorProfile", entityId: profile.id, action: "doctor.created" },
    });
    expect(audits).toHaveLength(1);
  });
});

afterAll(async () => {
  try {
    const clinicIds = (
      await db.clinic.findMany({
        where: { slug: { in: [CLINIC_A, CLINIC_B, CLINIC_C] } },
        select: { id: true },
      })
    ).map((c) => c.id);
    if (clinicIds.length > 0) {
      const doctorIds = (
        await db.doctorProfile.findMany({ where: { clinicId: { in: clinicIds } }, select: { id: true } })
      ).map((d) => d.id);
      if (doctorIds.length > 0) {
        await db.appointmentEvent.deleteMany({ where: { appointmentId: { in: (await db.appointment.findMany({ where: { doctorId: { in: doctorIds } }, select: { id: true } })).map((a) => a.id) } } });
        await db.appointment.deleteMany({ where: { doctorId: { in: doctorIds } } });
        await db.doctorSchedule.deleteMany({ where: { doctorId: { in: doctorIds } } });
        await db.doctorTimeOff.deleteMany({ where: { doctorId: { in: doctorIds } } });
      }
      await db.doctorProfile.deleteMany({ where: { clinicId: { in: clinicIds } } });
      await db.notification.deleteMany({ where: { clinicId: { in: clinicIds } } });
      await db.auditLog.deleteMany({ where: { clinicId: { in: clinicIds } } });
      await db.patientAccount.deleteMany({ where: { patient: { clinicId: { in: clinicIds } } } });
      await db.patient.deleteMany({ where: { clinicId: { in: clinicIds } } });
      await db.membership.deleteMany({ where: { clinicId: { in: clinicIds } } });
    }
    await db.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
    await db.clinic.deleteMany({ where: { slug: { in: [CLINIC_A, CLINIC_B, CLINIC_C] } } });
  } catch {
    // best-effort
  }
  await db.$disconnect();
});
