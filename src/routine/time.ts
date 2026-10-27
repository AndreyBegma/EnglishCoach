import { defaultRepeatStrategy } from "bullmq";

/** The three unsolicited messages a day: the morning and evening plans, and the evening nudge. */
export const ROUTINE_SLOTS = ["morning", "evening", "reminder"] as const;
export type RoutineSlot = (typeof ROUTINE_SLOTS)[number];

/** The reminder fires this long after `evening_time` when the goal is still open… */
export const REMINDER_DELAY_MINUTES = 120;
/** …unless that is in quiet hours: then this long before they start, if still after the evening. */
export const REMINDER_QUIET_LEAD_MINUTES = 30;

const MINUTES_PER_DAY = 24 * 60;

/**
 * Learner-local hours with no unsolicited reminder, as minutes after midnight; `start > end`
 * wraps midnight. A fixed default until notification settings exist (C-48).
 */
export const DEFAULT_QUIET_HOURS = { start: 22 * 60, end: 8 * 60 } as const;

export type QuietHours = { start: number; end: number };

/** Whether a minute of the day falls in `quiet`. */
export function isQuietMinute(minute: number, quiet: QuietHours = DEFAULT_QUIET_HOURS): boolean {
  const m = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return quiet.start <= quiet.end
    ? m >= quiet.start && m < quiet.end
    : m >= quiet.start || m < quiet.end;
}

/** Minutes after local midnight at `instant` in `zone`. */
export function localMinutes(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: safeZone(zone),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return part("hour") * 60 + part("minute");
}

/**
 * The reminder's minute of the day for an evening at `evening` minutes: evening + 2 h, pulled
 * back to `REMINDER_QUIET_LEAD_MINUTES` before quiet hours when it would land in them (the default
 * 20:00 evening → 21:30), but never to within 30 minutes of the evening itself — a reminder that
 * still falls in quiet hours is then dropped at fire time. May exceed a day (wraps past midnight).
 */
export function reminderMinute(evening: number, quiet: QuietHours = DEFAULT_QUIET_HOURS): number {
  const late = evening + REMINDER_DELAY_MINUTES;
  if (!isQuietMinute(late, quiet)) return late;
  const early = quiet.start - REMINDER_QUIET_LEAD_MINUTES;
  return early >= evening + REMINDER_QUIET_LEAD_MINUTES ? early : late;
}

/** `zone` when it is a time zone this runtime knows, else UTC — never a throw at fire time. */
export function safeZone(zone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

/** The learner's calendar date at `instant` in `zone`, as YYYY-MM-DD (`daily_stats.date`). */
export function localDate(instant: Date, zone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: safeZone(zone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Minutes after midnight of a `time` column value (`08:30` or `08:30:00`). */
export function minutesOf(time: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  if (!match || hours > 23 || minutes > 59) throw new Error(`not a time of day: "${time}"`);
  return hours * 60 + minutes;
}

/** A daily cron pattern at a minute of the day; the time zone travels next to it. */
export function dailyPattern(minuteOfDay: number): string {
  const minute = ((minuteOfDay % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${minute % 60} ${Math.floor(minute / 60)} * * *`;
}

export interface SlotSchedule {
  slot: RoutineSlot;
  /** Cron pattern evaluated in `tz` — wall-clock time, so it stays put across DST changes. */
  pattern: string;
  tz: string;
}

export interface RoutineTimes {
  timezone: string;
  morningTime: string;
  eveningTime: string;
}

/**
 * The learner's three daily slots. The reminder is evening + 2 h on the wall clock, kept out of
 * quiet hours where it can be (`reminderMinute`), and may wrap past midnight (evening 23:00 →
 * reminder 01:00 the next calendar day).
 */
export function slotSchedules(times: RoutineTimes): SlotSchedule[] {
  const tz = safeZone(times.timezone);
  const evening = minutesOf(times.eveningTime);
  return [
    { slot: "morning", pattern: dailyPattern(minutesOf(times.morningTime)), tz },
    { slot: "evening", pattern: dailyPattern(evening), tz },
    { slot: "reminder", pattern: dailyPattern(reminderMinute(evening)), tz },
  ];
}

/**
 * When a slot fires next after `after`, computed exactly as BullMQ's job scheduler does (the same
 * cron-parser call), so the tests of this function test production's timing.
 */
export function nextFire(schedule: SlotSchedule, after: Date): Date {
  const millis = defaultRepeatStrategy(after.getTime(), {
    pattern: schedule.pattern,
    tz: schedule.tz,
  });
  if (millis === undefined) throw new Error(`no next run for "${schedule.pattern}"`);
  return new Date(millis);
}

/**
 * The learner-local day a slot fired for. The reminder belongs to the evening before it, which
 * matters when it wraps past midnight: a 01:00 reminder judges yesterday's goal.
 */
export function slotDate(slot: RoutineSlot, firedAt: Date, zone: string): string {
  const shift = slot === "reminder" ? REMINDER_DELAY_MINUTES * 60_000 : 0;
  return localDate(new Date(firedAt.getTime() - shift), zone);
}
