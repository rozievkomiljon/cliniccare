/**
 * Timezone helpers built on `Intl` — no dependencies, usable on server and
 * client. Clinic-local wall-clock time is the only thing humans type or read;
 * `Date` instants (UTC) are what we store.
 *
 * DST edge semantics (documented on purpose):
 *  - an ambiguous local time (clocks fall back, occurs twice) resolves to the
 *    FIRST occurrence — the pre-transition offset;
 *  - a nonexistent local time (clocks spring forward, skipped hour) shifts
 *    backward by the gap length.
 * Both cases live at 02:00–03:00 local, outside typical clinic hours, and the
 * booking service re-validates the resulting instant against the schedule.
 */

export type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
};

export type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, fmt);
  }
  return fmt;
}

/** Validates an IANA zone name by asking Intl. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant as seen in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (east positive). */
function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, instant.getUTCSeconds(), instant.getUTCMilliseconds());
  return asUtc - instant.getTime();
}

/** Converts a clinic-local wall clock to its instant (see DST notes above). */
export function zonedTimeToInstant(local: LocalDateTime, timeZone: string): Date {
  const naive = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0, 0);
  // Two passes settle the offset on both sides of a transition.
  let ts = naive - offsetMs(new Date(naive), timeZone);
  ts = naive - offsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

/** Input format shared by all forms: `YYYY-MM-DDTHH:mm` (clinic-local). */
export const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function parseLocalDateTime(value: string, timeZone: string): Date | null {
  if (!LOCAL_DATE_TIME_PATTERN.test(value)) return null;
  const [datePart, timePart] = value.split("T");
  const [y, m, d] = (datePart ?? "").split("-").map(Number);
  const [hh, mm] = (timePart ?? "").split(":").map(Number);
  if ([y, m, d, hh, mm].some((n) => !Number.isFinite(n))) return null;
  return zonedTimeToInstant({ year: y!, month: m!, day: d!, hour: hh!, minute: mm! }, timeZone);
}

/** `YYYY-MM-DD` of an instant in `timeZone`. */
export function zonedDateString(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** `YYYY-MM-DD HH:MM` of an instant in `timeZone`. */
export function formatZoned(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${zonedDateString(instant, timeZone)} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** `HH:MM` of an instant in `timeZone`. */
export function formatZonedTime(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Minutes from local midnight (schedule math unit). */
export function minutesOfDayZoned(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  return p.hour * 60 + p.minute;
}

/** Local wall clock of an instant, as the `YYYY-MM-DDTHH:mm` form value. */
export function toLocalInputValue(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${zonedDateString(instant, timeZone)}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** `[start, end)` instants of one clinic-local calendar day. */
export function zonedDayRange(date: string, timeZone: string): { start: Date; end: Date } {
  const [y, m, d] = date.split("-").map(Number);
  const start = zonedTimeToInstant({ year: y!, month: m!, day: d!, hour: 0, minute: 0 }, timeZone);
  const end = zonedTimeToInstant({ year: y!, month: m!, day: d! + 1, hour: 0, minute: 0 }, timeZone);
  return { start, end };
}

/**
 * `[start, end)` instants of the clinic-local week (Sunday-based, matching the
 * calendar UI) containing `date`.
 */
export function zonedWeekRange(date: string, timeZone: string): { start: Date; end: Date; days: string[] } {
  const anchor = zonedDayRange(date, timeZone).start;
  const weekday = zonedParts(anchor, timeZone).weekday;
  const [y, m, d] = date.split("-").map(Number);
  const sunday = zonedTimeToInstant({ year: y!, month: m!, day: d! - weekday, hour: 0, minute: 0 }, timeZone);
  const nextSunday = zonedTimeToInstant({ year: y!, month: m!, day: d! - weekday + 7, hour: 0, minute: 0 }, timeZone);
  const days: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    days.push(zonedDateString(zonedTimeToInstant({ year: y!, month: m!, day: d! - weekday + i, hour: 12, minute: 0 }, timeZone), timeZone));
  }
  return { start: sunday, end: nextSunday, days };
}

/** Today's date in `timeZone`. */
export function zonedToday(timeZone: string, now: Date = new Date()): string {
  return zonedDateString(now, timeZone);
}

/**
 * Prefill value for booking forms: the next weekday at `hour:minute` wall clock
 * in `timeZone`, as the shared `YYYY-MM-DDTHH:mm` form value. Weekends are
 * skipped so the suggestion usually lands inside clinic hours.
 */
export function nextWeekdayLocalInput(
  timeZone: string,
  hour = 10,
  minute = 0,
  now: Date = new Date(),
): string {
  const today = zonedDateString(now, timeZone);
  const [y, m, d] = today.split("-").map(Number);
  for (let offset = 1; offset <= 8; offset += 1) {
    const instant = zonedTimeToInstant({ year: y!, month: m!, day: d! + offset, hour, minute }, timeZone);
    const weekday = zonedParts(instant, timeZone).weekday;
    if (weekday !== 0 && weekday !== 6) return toLocalInputValue(instant, timeZone);
  }
  // Unreachable: any eight consecutive days contain a weekday.
  return toLocalInputValue(zonedTimeToInstant({ year: y!, month: m!, day: d! + 1, hour, minute }, timeZone), timeZone);
}
