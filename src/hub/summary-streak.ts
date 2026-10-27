import type { Db } from "../db/client";
import { getSettings } from "../db/repositories/users";
import type { Logger } from "../log";
import { streakDays } from "../progress/streak";
import type { RestoreOffer } from "../progress/streak-rules";

/**
 * The restore offer the hub's main screen shows while a double goal today would restore the
 * streak yesterday broke. Never fails the hub: a streak that cannot be read shows no offer.
 */
export async function streakRestoreOffer(
  db: Db,
  userId: number,
  log: Logger,
  now: Date = new Date(),
): Promise<RestoreOffer | undefined> {
  try {
    const settings = await getSettings(db, userId);
    if (!settings?.cefrLevel) return undefined;
    return (await streakDays(db, userId, { now, timezone: settings.timezone })).restore;
  } catch (error) {
    log.warn("streak restore offer failed", { userId, error });
    return undefined;
  }
}
