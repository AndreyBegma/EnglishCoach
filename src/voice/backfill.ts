import type { Translator } from "../bot/i18n";
import type { Db } from "../db/client";
import { findUserByTelegramId, getSettings } from "../db/repositories/users";
import {
  countStoredSpeechSince,
  getStatusBoard,
  learnerEnglishVariants,
  ownerListSpeechTexts,
  saveStatusBoard,
  storedSpeechHashes,
} from "../db/repositories/voice";
import type { Logger } from "../log";
import type { EnglishVariant } from "./engines";
import type { StatusBoard } from "./status-board";
import { normalizeSpeechText, speechTextHash, type Tts } from "./tts";

const HOUR_MS = 3_600_000;
const BAR_CELLS = 10;

export interface VoiceBackfillDeps {
  db: Db;
  tts: Pick<Tts, "prewarm" | "primary" | "canPrewarm">;
  i18n: Translator;
  log: Logger;
  /** The status board; absent means the backfill runs without one. */
  board?: StatusBoard;
  /** `ADMIN_TELEGRAM_IDS`: admins are learners too, and the first one's UI language is the board's. */
  adminTelegramIds?: readonly number[];
  now?: () => Date;
}

type Kind = "words" | "examples";

/** How far the backfill is, for one run. */
interface Progress {
  done: Record<Kind, number>;
  total: Record<Kind, number>;
  failures: number;
  failuresOn: string;
  state: "running" | "done";
}

/**
 * Voices the owner's list ahead of time — every word, then every example sentence, in each
 * English variant learners use — a slice per run, through `tts.prewarm` (which spaces uploads
 * out). Server engines only: background work never spends a learner's key. Keeps the status board
 * in the storage chat current: at the start, at most once a minute while it runs, at the end.
 */
export class VoiceBackfill {
  constructor(private readonly deps: VoiceBackfillDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Voices up to `limit` texts not voiced yet; returns how many were newly stored. */
  async run(limit: number): Promise<number> {
    const { db, tts } = this.deps;
    const primary = tts.primary();
    if (!tts.canPrewarm || !primary) return 0;
    const variants = await learnerEnglishVariants(db, this.deps.adminTelegramIds);
    if (variants.length === 0) return 0;

    const texts = await ownerListSpeechTexts(db);
    const unique: Record<Kind, string[]> = {
      words: distinct(texts.words),
      examples: distinct(texts.examples),
    };
    const voices = variants.map((variant) => primary.voices[variant]);
    const stored = await storedSpeechHashes(db, voices);

    const progress = await this.startProgress();
    const todo: { text: string; variant: EnglishVariant; kind: Kind }[] = [];
    for (const kind of ["words", "examples"] as const) {
      progress.total[kind] = unique[kind].length * variants.length;
      for (const variant of variants) {
        const have = stored.get(primary.voices[variant]) ?? new Set<string>();
        for (const text of unique[kind]) {
          if (have.has(speechTextHash(text))) progress.done[kind]++;
          else todo.push({ text, variant, kind });
        }
      }
    }

    const slice = todo.slice(0, limit);
    progress.state = slice.length ? "running" : "done";
    await this.render(progress, voices, primary.engine, true);
    let generated = 0;
    for (const item of slice) {
      const result = await tts.prewarm([item.text], item.variant);
      generated += result.generated;
      progress.done[item.kind] += result.generated + result.stored;
      if (result.failed) await this.fail(progress, result.failed);
      await this.render(progress, voices, primary.engine, false);
    }
    progress.state = "done";
    await this.render(progress, voices, primary.engine, true);
    this.deps.log.info("voice backfill run", { generated, remaining: todo.length - generated });
    return generated;
  }

  private chatId(): number | undefined {
    return this.deps.board?.chatId;
  }

  /** Today's failure count, from the board's row; a new UTC day starts at zero. */
  private async startProgress(): Promise<Progress> {
    const today = this.now().toISOString().slice(0, 10);
    const chatId = this.chatId();
    const row = chatId === undefined ? undefined : await getStatusBoard(this.deps.db, chatId);
    return {
      done: { words: 0, examples: 0 },
      total: { words: 0, examples: 0 },
      failures: row?.failuresOn === today ? row.failures : 0,
      failuresOn: today,
      state: "running",
    };
  }

  private async fail(progress: Progress, count: number): Promise<void> {
    const today = this.now().toISOString().slice(0, 10);
    if (progress.failuresOn !== today) {
      progress.failuresOn = today;
      progress.failures = 0;
    }
    progress.failures += count;
    const chatId = this.chatId();
    if (chatId === undefined) return;
    await saveStatusBoard(this.deps.db, chatId, {
      failuresOn: progress.failuresOn,
      failures: progress.failures,
    });
  }

  private async render(progress: Progress, voices: string[], engine: string, force: boolean) {
    const { board } = this.deps;
    if (!board || (!force && !board.due())) return;
    await board.show(await this.text(progress, voices, engine), { force });
  }

  /** The board's text, in the owner's UI language. Numbers are plain: no grouping, no units. */
  private async text(progress: Progress, voices: string[], engine: string): Promise<string> {
    const { db, i18n } = this.deps;
    const locale = await this.locale();
    const t = (key: string, vars?: Record<string, string | number>) => i18n.t(locale, key, vars);
    const now = this.now();
    const midnight = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
    const [today, day, hour] = await Promise.all([
      countStoredSpeechSince(db, voices, midnight),
      countStoredSpeechSince(db, voices, new Date(now.getTime() - 24 * HOUR_MS)),
      countStoredSpeechSince(db, voices, new Date(now.getTime() - HOUR_MS)),
    ]);
    const total = progress.total.words + progress.total.examples;
    const remaining = total - progress.done.words - progress.done.examples;
    const line = (kind: Kind) => {
      const done = progress.done[kind];
      const all = progress.total[kind];
      const percent = all ? Math.floor((done / all) * 100) : 100;
      return t(`voice-board-${kind}`, {
        done: String(done),
        total: String(all),
        percent: String(percent),
        bar: bar(percent),
      });
    };
    const eta =
      remaining === 0
        ? t("voice-board-eta-none")
        : hour === 0
          ? t("voice-board-eta-unknown")
          : t("voice-board-eta", {
              hours: String(Math.floor(remaining / hour)),
              minutes: String(Math.round(((remaining % hour) / hour) * 60)),
              rate: String(hour),
            });
    return [
      `<b>${t(progress.state === "running" ? "voice-board-running" : "voice-board-idle")}</b>`,
      line("words"),
      line("examples"),
      t("voice-board-remaining", { remaining: String(remaining), eta }),
      t("voice-board-recent", { today: String(today), day: String(day) }),
      t("voice-board-failures", { count: String(progress.failures) }),
      t("voice-board-engine", { engine, voices: voices.join(", ") }),
      t("voice-board-updated", { time: now.toISOString().slice(0, 16).replace("T", " ") }),
    ].join("\n");
  }

  /** The first admin's UI language, else English. */
  private async locale(): Promise<string> {
    const [owner] = this.deps.adminTelegramIds ?? [];
    if (owner === undefined) return "en";
    const user = await findUserByTelegramId(this.deps.db, owner);
    const settings = user && (await getSettings(this.deps.db, user.id));
    return settings?.uiLang ?? "en";
  }
}

/** Each text once, by what the speech cache considers the same text. */
function distinct(texts: readonly string[]): string[] {
  const seen = new Set<string>();
  return texts.filter((text) => {
    const key = normalizeSpeechText(text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function bar(percent: number): string {
  const full = Math.min(BAR_CELLS, Math.floor(percent / BAR_CELLS));
  return "▓".repeat(full) + "░".repeat(BAR_CELLS - full);
}
