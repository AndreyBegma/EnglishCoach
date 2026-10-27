import type { Db } from "../db/client";
import { findUnseenWords } from "../db/repositories/words";
import { type CefrLevel, cefrLevelEnum, type Word } from "../db/schema";

/** Share of a pick that may come from the level above the learner's. */
const LEVEL_UP_SHARE = 0.2;

function nextLevel(level: CefrLevel): CefrLevel | undefined {
  return cefrLevelEnum.enumValues[cefrLevelEnum.enumValues.indexOf(level) + 1];
}

export class WordPicker {
  constructor(private readonly db: Db) {}

  /**
   * Picks `n` words the user has no card for: at most floor(0.2 * n) from one level above, the rest
   * at `level`, each tier by frequency rank. A tier that runs dry is topped up from the other, so
   * fewer than `n` words come back only when both are exhausted. Same data in, same words out.
   */
  async pickNew(userId: number, level: CefrLevel, n: number): Promise<Word[]> {
    if (n <= 0) return [];

    const upper = nextLevel(level);
    const upperQuota = upper ? Math.floor(n * LEVEL_UP_SHARE) : 0;

    const base = await findUnseenWords(this.db, userId, level, n - upperQuota);
    const missing = n - upperQuota - base.length;
    const up = upper ? await findUnseenWords(this.db, userId, upper, upperQuota + missing) : [];

    // The upper level ran short while the learner's own level may still have more.
    if (base.length + up.length < n && base.length === n - upperQuota) {
      return [...(await findUnseenWords(this.db, userId, level, n - up.length)), ...up];
    }
    return [...base, ...up];
  }

  /**
   * The next `n` words Learn words will show, in order, if the learner takes them one at a time:
   * a single pick has no level-up share, so it is the learner's level until it runs dry, then the
   * level above. Prefetch enriches exactly these.
   */
  async upcoming(userId: number, level: CefrLevel, n: number): Promise<Word[]> {
    if (n <= 0) return [];
    const base = await findUnseenWords(this.db, userId, level, n);
    const upper = nextLevel(level);
    if (base.length >= n || !upper) return base;
    return [...base, ...(await findUnseenWords(this.db, userId, upper, n - base.length))];
  }
}
