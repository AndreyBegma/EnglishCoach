import { describe, expect, test } from "bun:test";
import { DEFAULT_MODELS, modelCapabilities, samplingParams } from "../../src/llm/models";

describe("modelCapabilities", () => {
  test("current Anthropic models use structured outputs and take no sampling parameters", () => {
    for (const model of [
      ...Object.values(DEFAULT_MODELS.anthropic),
      "claude-opus-5-5",
      "claude-fable-5-1",
      "claude-sonnet-4-5",
      "claude-opus-4-1-20250805",
      "a-model-nobody-has-heard-of",
    ]) {
      expect(modelCapabilities("anthropic", model)).toEqual({
        structuredOutput: "json_schema",
        sampling: false,
      });
    }
  });

  test("Anthropic models that predate structured outputs force a tool instead", () => {
    for (const model of [
      "claude-3-7-sonnet-latest",
      "claude-3-5-haiku-20241022",
      "claude-sonnet-4-0",
      "claude-opus-4-20250514",
    ]) {
      expect(modelCapabilities("anthropic", model).structuredOutput).toBe("forced_tool");
    }
  });

  test("OpenAI reasoning families drop sampling; other models and routers keep it", () => {
    for (const model of [...Object.values(DEFAULT_MODELS.openai), "o3", "openai/gpt-5-mini"]) {
      expect(modelCapabilities("openai", model).sampling).toBe(false);
    }
    for (const model of ["gpt-4.1", "meta-llama/llama-4-maverick", "mistral-large"]) {
      expect(modelCapabilities("openai", model).sampling).toBe(true);
    }
  });

  test("the claude CLI has no sampling flag", () => {
    expect(modelCapabilities("claude-code", "sonnet").sampling).toBe(false);
  });
});

describe("samplingParams", () => {
  test("sends temperature only when set and allowed", () => {
    const allowed = { structuredOutput: "json_schema", sampling: true } as const;
    expect(samplingParams(allowed, 0.4)).toEqual({ temperature: 0.4 });
    expect(samplingParams(allowed, 0)).toEqual({ temperature: 0 });
    expect(samplingParams(allowed, undefined)).toEqual({});
    expect(samplingParams({ ...allowed, sampling: false }, 0.4)).toEqual({});
  });
});
