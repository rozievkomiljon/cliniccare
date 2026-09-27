/**
 * Slot builder unit tests: schedule windows become slot grids, appointments
 * claim the slots they overlap, and anything off-grid is surfaced separately.
 * Uses a non-UTC clinic so slot instants prove the timezone wiring.
 */
import { describe, expect, it } from "vitest";

import { buildDayTimeline, type SlotAppointment } from "@/features/appointments/slots";

const NY = "America/New_York";
const MONDAY = "2027-01-04"; // EST: UTC−5

const schedule = { weekday: 1, startMinute: 540, endMinute: 630, slotMinutes: 30 }; // 09:00–10:30

function appt(over: Partial<SlotAppointment> & { id: string; scheduledAt: string }): SlotAppointment {
  return {
    durationMinutes: 30,
    status: "CONFIRMED",
    patientName: "Test Patient",
    ...over,
  };
}

describe("buildDayTimeline", () => {
  it("produces one slot per schedule window step in clinic-local time", () => {
    const timeline = buildDayTimeline({ date: MONDAY, timeZone: NY, schedule, appointments: [] });
    expect(timeline.slots.map((s) => s.label)).toEqual(["09:00", "09:30", "10:00"]);
    expect(timeline.slots[0]!.start.toISOString()).toBe("2027-01-04T14:00:00.000Z"); // 09:00 EST
    expect(timeline.slots[1]!.end.getTime() - timeline.slots[1]!.start.getTime()).toBe(30 * 60_000);
    expect(timeline.outsideSchedule).toEqual([]);
  });

  it("marks the slot(s) an appointment overlaps, including odd durations", () => {
    const booked = appt({ id: "a1", scheduledAt: "2027-01-04T14:30:00.000Z", durationMinutes: 60 }); // 09:30–10:30 local
    const timeline = buildDayTimeline({ date: MONDAY, timeZone: NY, schedule, appointments: [booked] });

    expect(timeline.slots.map((s) => s.appointment?.id)).toEqual([undefined, "a1", "a1"]);
    expect(timeline.outsideSchedule).toEqual([]);
  });

  it("leaves adjacent slots free and surfaces off-schedule appointments", () => {
    const adjacent = appt({ id: "a1", scheduledAt: "2027-01-04T14:00:00.000Z", durationMinutes: 30 }); // 09:00–09:30
    const early = appt({ id: "a2", scheduledAt: "2027-01-04T13:00:00.000Z", durationMinutes: 30 }); // 08:00 local, before shift
    const timeline = buildDayTimeline({ date: MONDAY, timeZone: NY, schedule, appointments: [adjacent, early] });

    expect(timeline.slots[0]!.appointment?.id).toBe("a1");
    expect(timeline.slots[1]!.appointment).toBeUndefined();
    expect(timeline.outsideSchedule.map((a) => a.id)).toEqual(["a2"]);
  });

  it("returns no slots but keeps appointments when the doctor has no shift that day", () => {
    const booked = appt({ id: "a1", scheduledAt: "2027-01-04T14:00:00.000Z" });
    const timeline = buildDayTimeline({ date: MONDAY, timeZone: NY, schedule: null, appointments: [booked] });
    expect(timeline.slots).toEqual([]);
    expect(timeline.outsideSchedule.map((a) => a.id)).toEqual(["a1"]);
  });

  it("keeps local slot labels stable across a DST transition day", () => {
    // 2027-03-14: clocks spring forward at 02:00 in New York.
    const springSchedule = { weekday: 0, startMinute: 540, endMinute: 660, slotMinutes: 60 };
    const timeline = buildDayTimeline({
      date: "2027-03-14",
      timeZone: NY,
      schedule: springSchedule,
      appointments: [],
    });
    expect(timeline.slots.map((s) => s.label)).toEqual(["09:00", "10:00"]);
    // 09:00 EDT == 13:00Z (not 14:00Z as it would be before the transition).
    expect(timeline.slots[0]!.start.toISOString()).toBe("2027-03-14T13:00:00.000Z");
  });
});
