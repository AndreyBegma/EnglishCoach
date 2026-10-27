import { type FSRS, fsrs } from "ts-fsrs";

/** The desired-retention setting, in percent: the closed range and its buttons. */
export const RETENTION_MIN = 85;
export const RETENTION_MAX = 95;
export const DEFAULT_RETENTION = 90;
export const RETENTION_OPTIONS = [85, 88, 90, 92, 95] as const;
export type RetentionOption = (typeof RETENTION_OPTIONS)[number];

/** What a learner's schedulers are built from. */
export interface FsrsProfile {
  /** Desired retention in percent, `RETENTION_MIN`..`RETENTION_MAX`. */
  retention: number;
  /** The learner's fitted FSRS-6 weights; null runs the ts-fsrs defaults. */
  weights: readonly number[] | null;
}

export const DEFAULT_PROFILE: FsrsProfile = { retention: DEFAULT_RETENTION, weights: null };

export interface SchedulerOptions {
  /**
   * Short-term learning steps (minutes) before the first interval in days. Words use them; topics
   * are reviewed in days and turn them off.
   */
  shortTerm: boolean;
}

/**
 * The one way to build an FSRS scheduler: the learner's retention and weights, no fuzz. Every
 * scheduler call site gets its instance from here (or from `fsrsFor`), never from `fsrs()`.
 */
export function schedulerFrom(profile: FsrsProfile, options: SchedulerOptions): FSRS {
  const retention = Math.min(RETENTION_MAX, Math.max(RETENTION_MIN, profile.retention));
  return fsrs({
    request_retention: retention / 100,
    enable_short_term: options.shortTerm,
    ...(profile.weights ? { w: [...profile.weights] } : {}),
  });
}
