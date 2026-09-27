/**
 * Timezone engine unit tests. Assertions are concrete UTC instants derived
 * from the IANA rules (EST −5 / EDT −4, CET +1 / CEST +2), plus the documented
 * DST edge semantics; the last group runs the same paths through a non-UTC
 * clinic so the scheduler cannot silently assume UTC.
 */
import { describe, expect, it } from "vitest";

import {
  formatZoned,
  formatZonedTime,
  isValidTimeZone,
  minutesOfDayZoned,
  parseLocalDateTime,
  toLocalInputValue,
  zonedDayRange,
  zonedDateString,
  zonedParts,
  zonedTimeToInstant,
  zonedToday,
  zonedWeekRange,
} from "@/lib/timezone";

const NY = "America/New_York";
const BERLIN = "Europe/Berlin";

describe("timezone conversions", () => {
  it("maps clinic-local wall clock to instants across DST offsets", () => {
    expect(parseLocalDateTime("2027-01-04T09:00", NY)!.toISOString()).toBe("2027-01-04T14:00:00.000Z"); // EST −5
    expect(parseLocalDateTime("2027-07-05T09:00", NY)!.toISOString()).toBe("2027-07-05T13:00:00.000Z"); // EDT −4
    expect(parseLocalDateTime("2027-01-04T09:00", BERLIN)!.toISOString()).toBe("2027-01-04T08:00:00.000Z"); // CET +1
    expect(parseLocalDateTime("2027-07-05T09:00", BERLIN)!.toISOString()).toBe("2027-07-05T07:00:00.000Z"); // CEST +2
    expect(parseLocalDateTime("2027-01-04T09:00", "UTC")!.toISOString()).toBe("2027-01-04T09:00:00.000Z");
  });

  it("resolves ambiguous and nonexistent local times deterministically", () => {
    // Clocks fall back: 01:30 happens twice → the first (EDT) occurrence wins.
    expect(parseLocalDateTime("2026-11-01T01:30", NY)!.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    // Clocks spring forward: 02:30 does not exist → shifts back by the gap.
    expect(parseLocalDateTime("2026-03-08T02:30", NY)!.toISOString()).toBe("2026-03-08T06:30:00.000Z");
  });

  it("reports weekday and minute-of-day in the clinic zone", () => {
    const berlinMonday9 = parseLocalDateTime("2027-01-04T09:00", BERLIN)!;
    expect(zonedParts(berlinMonday9, BERLIN).weekday).toBe(1);
    expect(minutesOfDayZoned(berlinMonday9, BERLIN)).toBe(540);

    // 23:30 New York is already the next day in Berlin.
    const nyLate = parseLocalDateTime("2027-01-04T23:30", NY)!;
    expect(zonedDateString(nyLate, NY)).toBe("2027-01-04");
    expect(zonedDateString(nyLate, BERLIN)).toBe("2027-01-05");
    expect(zonedParts(nyLate, BERLIN).weekday).toBe(2);
  });

  it("formats and round-trips the form value", () => {
    const instant = parseLocalDateTime("2027-07-05T16:45", BERLIN)!;
    expect(formatZoned(instant, BERLIN)).toBe("2027-07-05 16:45");
    expect(formatZonedTime(instant, BERLIN)).toBe("16:45");
    expect(toLocalInputValue(instant, BERLIN)).toBe("2027-07-05T16:45");
    expect(toLocalInputValue(instant, NY)).toBe("2027-07-05T10:45");
    expect(parseLocalDateTime(toLocalInputValue(instant, BERLIN), BERLIN)!.getTime()).toBe(instant.getTime());
  });

  it("builds local day and Sunday-based week ranges", () => {
    const day = zonedDayRange("2027-01-04", BERLIN);
    expect(day.start.toISOString()).toBe("2027-01-03T23:00:00.000Z");
    expect(day.end.toISOString()).toBe("2027-01-04T23:00:00.000Z");
    expect(day.end.getTime() - day.start.getTime()).toBe(24 * 3600 * 1000);

    const week = zonedWeekRange("2027-01-04", BERLIN);
    expect(week.days).toEqual([
      "2027-01-03",
      "2027-01-04",
      "2027-01-05",
      "2027-01-06",
      "2027-01-07",
      "2027-01-08",
      "2027-01-09",
    ]);
    expect(week.start.toISOString()).toBe("2027-01-02T23:00:00.000Z");
    expect(week.end.toISOString()).toBe("2027-01-09T23:00:00.000Z");
  });

  it("rejects malformed input and unknown zones", () => {
    expect(parseLocalDateTime("2027-01-04 09:00", NY)).toBeNull();
    expect(parseLocalDateTime("2027-01-04T09", NY)).toBeNull();
    expect(parseLocalDateTime("", NY)).toBeNull();
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });

  it("derives today and constructor-level instants", () => {
    expect(zonedToday("UTC", new Date("2027-01-04T23:59:00.000Z"))).toBe("2027-01-04");
    expect(zonedToday(BERLIN, new Date("2027-01-04T23:59:00.000Z"))).toBe("2027-01-05");
    expect(zonedTimeToInstant({ year: 2027, month: 1, day: 4, hour: 9, minute: 0 }, "UTC").toISOString()).toBe(
      "2027-01-04T09:00:00.000Z",
    );
  });
});
