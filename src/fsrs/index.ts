import type { FSRS } from "ts-fsrs";
import { getFsrsProfileRow } from "../db/repositories/fsrs";
import type { Tx } from "../db/repositories/levels";
import {
  DEFAULT_PROFILE,
  type FsrsProfile,
  type SchedulerOptions,
  schedulerFrom,
} from "./scheduler";

export * from "./scheduler";

/** The learner's retention setting and fitted weights; the defaults for a user with no settings. */
export async function fsrsProfile(db: Tx, userId: number): Promise<FsrsProfile> {
  const row = await getFsrsProfileRow(db, userId);
  return row ? { retention: row.retention, weights: row.weights } : DEFAULT_PROFILE;
}

/**
 * The learner's FSRS scheduler: their desired retention and their own fitted parameters. Every
 * scheduler call site — words, grammar topics, mistake patterns — rates cards through this.
 * Words keep short-term steps (the default); topics pass `{ shortTerm: false }`.
 */
export async function fsrsFor(
  db: Tx,
  userId: number,
  options: SchedulerOptions = { shortTerm: true },
): Promise<FSRS> {
  return schedulerFrom(await fsrsProfile(db, userId), options);
}
