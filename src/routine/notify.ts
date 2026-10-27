import type { RoutineStore } from "./ports";
import {
  DEFAULT_QUIET_HOURS,
  isQuietMinute,
  localDate,
  localMinutes,
  type RoutineSlot,
} from "./time";

/** Unsolicited messages a learner gets in one local day, at most. */
export const MAX_NOTIFICATIONS_PER_DAY = 3;

export interface NotificationRequest {
  userId: number;
  slot: RoutineSlot;
  now: Date;
  /** The learner's IANA zone. */
  timezone: string;
}

/**
 * Whether an unsolicited routine message may go out now, and if so takes one of the day's
 * `MAX_NOTIFICATIONS_PER_DAY`. The reminder stays out of quiet hours; the morning and evening
 * plans come at times the learner picked, so only the daily cap holds them. Returns the release
 * that gives the reservation back when the message could not be sent.
 *
 * The one place notification rules live until notification settings exist (C-48 replaces it with
 * the learner's own switches and quiet hours).
 */
export async function reserveNotification(
  store: RoutineStore,
  { userId, slot, now, timezone }: NotificationRequest,
): Promise<(() => Promise<void>) | undefined> {
  if (slot === "reminder" && isQuietMinute(localMinutes(now, timezone), DEFAULT_QUIET_HOURS)) {
    return undefined;
  }
  const date = localDate(now, timezone);
  if (!(await store.reserveNotification(userId, date, MAX_NOTIFICATIONS_PER_DAY))) return undefined;
  return () => store.releaseNotification(userId, date);
}
