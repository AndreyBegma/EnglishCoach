import { describe, expect, test } from "bun:test";
import { createAnthropicProvider } from "../../src/llm/providers/anthropic";
import { createClaudeCodeProvider } from "../../src/llm/providers/claude-code";
import { createOpenAiProvider } from "../../src/llm/providers/openai";
import type { LlmProvider } from "../../src/llm/types";
import { type LearnerContext, loadSkillRegistry, SkillRunner } from "../../src/skills";

// Opt-in: real calls cost money and need keys, so CI never runs these.
//   LLM_LIVE_TESTS=1 SERVER_ANTHROPIC_API_KEY=… bun test test/skills/live.test.ts
// Each provider runs only when its credentials (or the claude binary) are present.
const live = process.env.LLM_LIVE_TESTS === "1";
const env = process.env;
const claudeBin = env.CLAUDE_BIN || "claude";
const TIMEOUT_MS = 180_000;

const learner: LearnerContext = {
  level: "B1",
  explainLang: "uk",
  uiLang: "uk",
  nativeLang: "uk",
  interests: ["football"],
  weakSpots: [
    {
      category: "grammar",
      pattern: "present simple instead of present perfect with since",
      exampleWrong: "I live here since 2020",
      exampleRight: "I have lived here since 2020",
      timesSeen: 3,
    },
  ],
};

async function smoke(provider: LlmProvider) {
  const runner = new SkillRunner({
    registry: loadSkillRegistry(),
    provider: async () => provider,
    learner: async () => learner,
  });
  // The provider already validated the output against the schema; this proves the round trip.
  const { data } = await runner.runSkill(1, "grammar-quiz", {
    recent_accuracy: 0.65,
    item_type: "gap_fill",
  });
  expect(data.type).toBe("gap_fill");
  expect(data.question).toContain("___");
  expect(data.accepted_answers.length).toBeGreaterThan(0);
}

describe.skipIf(!live)("live skill smoke test (LLM_LIVE_TESTS=1)", () => {
  test.skipIf(!env.SERVER_ANTHROPIC_API_KEY)(
    "anthropic runs grammar-quiz",
    () => smoke(createAnthropicProvider({ apiKey: env.SERVER_ANTHROPIC_API_KEY ?? "" })),
    TIMEOUT_MS,
  );

  test.skipIf(!env.SERVER_OPENAI_API_KEY)(
    "openai runs grammar-quiz",
    () =>
      smoke(
        createOpenAiProvider({
          apiKey: env.SERVER_OPENAI_API_KEY ?? "",
          baseUrl: env.SERVER_OPENAI_BASE_URL || null,
          model: env.LLM_LIVE_OPENAI_MODEL || null,
        }),
      ),
    TIMEOUT_MS,
  );

  test.skipIf(!Bun.which(claudeBin))(
    "claude-code runs grammar-quiz",
    () => smoke(createClaudeCodeProvider({ command: [claudeBin], timeoutMs: TIMEOUT_MS - 5_000 })),
    TIMEOUT_MS,
  );
});
