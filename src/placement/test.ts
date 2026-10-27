import type { CefrLevel } from "../db/schema";
import { bandOf } from "../levels/model";
import { seedPlacementLevels } from "../levels/seed-placement";
import type { Logger } from "../log";
import type { PlacementSection } from "../skills/schemas";
import {
  completeItem,
  currentSection,
  finalResults,
  gradeTask,
  type PlacementProgress,
  type SectionResult,
  scoreAnswer,
  skipSection,
  startProgress,
} from "./engine";
import { gradeAnswer, type ItemDeps, nextItem, PlacementError, type PlacementItem } from "./items";
import { type TopicFlagWriter, topicFlags } from "./topics";

/**
 * The test inside the placement session's flow state. Nothing in it is stored until the test is
 * finished, so a session that ends early (cancelled, expired) leaves no trace and the next one
 * starts the test over, as the owner decided (taken in one go).
 */
export interface TestState {
  progress: PlacementProgress;
  /** The item on screen; undefined while the next one is being prepared. */
  item?: PlacementItem;
  /** Which of the item's questions is on screen. */
  question: number;
  /** A voice section waits for the learner to turn voice on, or to skip it. */
  needsVoice?: boolean;
}

export function startTest(): TestState {
  return { progress: startProgress(), question: 0 };
}

/** What the test may use of the learner's voice set-up when it prepares the next item. */
export interface VoiceCheck {
  /** `user_settings.voice_enabled`. */
  enabled: boolean;
  /** Whether a voice note can be produced for this learner at all. */
  canSpeak(): Promise<boolean>;
}

export interface PlacementTestDeps extends ItemDeps {
  log: Logger;
  /** Where the topic flags go; absent until the grammar module's topic progress exists. */
  topicFlags?: TopicFlagWriter;
}

export type TestOutcome = {
  band: CefrLevel;
  results: Record<PlacementSection, SectionResult>;
};

/** The voice sections: listening plays the item, speaking takes a voice answer. */
const VOICE_SECTIONS: ReadonlySet<PlacementSection> = new Set(["listening", "speaking"]);

export class PlacementTest {
  constructor(private readonly deps: PlacementTestDeps) {}

  /**
   * Makes sure there is something to show: the current item, the voice question, or nothing
   * when the test is over. Listening with no way to voice it is skipped on its own.
   */
  async prepare(userId: number, test: TestState, voice: VoiceCheck): Promise<void> {
    while (!test.item) {
      const section = currentSection(test.progress);
      if (!section) return;
      if (VOICE_SECTIONS.has(section) && !voice.enabled) {
        test.needsVoice = true;
        return;
      }
      test.needsVoice = false;
      if (section === "listening" && !(await voice.canSpeak())) {
        test.progress = skipSection(test.progress);
        continue;
      }
      test.item = await nextItem(this.deps, userId, test.progress);
      test.question = 0;
    }
  }

  /** A multiple-choice answer to the question on screen. */
  answer(test: TestState, index: number): void {
    const item = test.item;
    const question = item?.questions[test.question];
    if (!item || !question) throw new PlacementError("no question on screen");
    const correct = index === question.correct_index;
    test.progress = scoreAnswer(test.progress, item.level, correct, item.topicId);
    test.question += 1;
    if (test.question < item.questions.length) return;
    test.progress = completeItem(test.progress, item.subject);
    test.item = undefined;
  }

  /** A writing or speaking answer, graded against the task's rubric. */
  async submit(userId: number, test: TestState, answer: string): Promise<void> {
    const item = test.item;
    if (!item) throw new PlacementError("no task on screen");
    const grade = await gradeAnswer(this.deps.skills, userId, item, answer);
    test.progress = gradeTask(test.progress, grade.level, grade.feedback, item.subject);
    test.item = undefined;
  }

  /** Skips the current section (a voice section the learner cannot take). */
  skip(test: TestState): void {
    test.progress = skipSection(test.progress);
    test.item = undefined;
    test.needsVoice = false;
  }

  /** Undefined until the last section is done. */
  outcome(test: TestState): Record<PlacementSection, SectionResult> | undefined {
    return finalResults(test.progress);
  }

  /**
   * Stores a finished test: every skill's level, the cache, then the early syllabus topics'
   * flags. A failing flag writer is logged; the levels are what the test is for.
   */
  async finish(userId: number, test: TestState): Promise<TestOutcome> {
    const results = finalResults(test.progress);
    if (!results) throw new PlacementError("the test is not finished");
    const band = await seedPlacementLevels(this.deps.db, userId, results);
    const flags = topicFlags(
      this.deps.topics,
      bandOf(results.grammar.rating),
      test.progress.topics,
    );
    try {
      await this.deps.topicFlags?.write(userId, flags);
    } catch (error) {
      this.deps.log.warn("placement topic flags failed", { userId, error });
    }
    return { band, results };
  }
}
