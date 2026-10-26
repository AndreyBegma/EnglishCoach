import { describe, expect, test } from "bun:test";
import { parseCallback } from "../../src/bot/callbacks";
import { createI18n } from "../../src/bot/i18n";
import { encodeTalkCallback, parseTalkCallback } from "../../src/talk/callbacks";
import { conversationPattern } from "../../src/talk/mistakes";
import { escapeHtml, renderTurn, summarise } from "../../src/talk/render";
import { capHistory, HISTORY_LIMIT, newTalkState } from "../../src/talk/state";
import { suggestTopics } from "../../src/talk/topics";

const i18n = createI18n();

describe("talk callbacks", () => {
  test("round-trip and stay under 64 bytes", () => {
    for (const callback of [
      { type: "pick", sessionId: 4_000_000_000, topic: 5 },
      { type: "pick", sessionId: 7, topic: "free" },
      { type: "finish", sessionId: 12 },
    ] as const) {
      const data = encodeTalkCallback(callback);
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
      expect(parseTalkCallback(data)).toEqual(callback);
    }
  });

  test("foreign, stale and malformed data is not ours", () => {
    expect(parseTalkCallback("1:a:talk")).toBeUndefined();
    expect(parseTalkCallback("2:t:f:1")).toBeUndefined();
    expect(parseTalkCallback("1:t:f:abc")).toBeUndefined();
    expect(parseTalkCallback("1:t:p:1:x")).toBeUndefined();
    expect(parseTalkCallback(undefined)).toBeUndefined();
  });

  test("the shared codec ignores them, so they fall through to Talk", () => {
    expect(parseCallback(encodeTalkCallback({ type: "finish", sessionId: 1 }))).toBeUndefined();
  });
});

describe("history window", () => {
  const exchange = (n: number) => [
    { role: "user" as const, content: `u${n}` },
    { role: "assistant" as const, content: `a${n}` },
  ];

  test("keeps the last 12 messages and starts on a learner turn", () => {
    const history = Array.from({ length: 10 }, (_, n) => exchange(n)).flat();
    const capped = capHistory(history);
    expect(capped).toHaveLength(HISTORY_LIMIT);
    expect(capped[0]).toEqual({ role: "user", content: "u4" });
    expect(capped.at(-1)).toEqual({ role: "assistant", content: "a9" });
  });

  test("a cut that lands on a bot reply drops it", () => {
    const history = Array.from({ length: 6 }, (_, n) => exchange(n)).flat();
    const capped = capHistory([...history, { role: "user", content: "u6" }]);
    expect(capped).toHaveLength(HISTORY_LIMIT - 1);
    expect(capped[0]).toEqual({ role: "user", content: "u1" });
    expect(capHistory([{ role: "assistant", content: "orphan" }, ...exchange(1)])).toEqual(
      exchange(1),
    );
  });
});

describe("rendering", () => {
  const turn = {
    reply: "Nice <b>one</b> & more",
    corrections: [
      {
        original: "I go <i>",
        corrected: "I went",
        category: "grammar" as const,
        severity: "critical" as const,
        why: "past simple & more",
      },
    ],
    tip: { kind: "phrase" as const, text: "Say <it> like this" },
  };

  test("escapes everything the model wrote and shows the correction format", () => {
    const text = renderTurn(i18n, "en", turn, true);
    expect(text).toContain("Nice &lt;b&gt;one&lt;/b&gt; &amp; more");
    expect(text).toContain("1. <s>I go &lt;i&gt;</s> → <b>I went</b> · Grammar");
    expect(text).toContain("<i>past simple &amp; more</i>");
    expect(text).toContain("Say &lt;it&gt; like this");
    expect(escapeHtml("a<b>&")).toBe("a&lt;b&gt;&amp;");
  });

  test("no corrections → the no-errors line; no tip unless asked", () => {
    const text = renderTurn(i18n, "en", { ...turn, corrections: [] }, false);
    expect(text).toContain("✅ No errors — nice work!");
    expect(text).not.toContain("💡");
  });

  test("summary line", () => {
    const state = newTalkState(1, null, true);
    expect(summarise(i18n, "en", state).line).toBe("Talk: no messages");
    state.messages = 9;
    state.corrections = 4;
    expect(summarise(i18n, "en", state).line).toBe("Talk: 9 messages, 4 corrections");
    state.categories = { grammar: 1, word_choice: 3 };
    expect(summarise(i18n, "en", state)).toMatchObject({
      line: "Talk: 9 messages, 4 corrections, top: word choice",
      topCategory: "word_choice",
    });
    state.messages = 1;
    state.corrections = 1;
    expect(summarise(i18n, "ru", state).line).toContain("1 сообщение, 1 исправление");
  });
});

describe("topics", () => {
  test("interests first (≤3, deduplicated), then three stock topics for the level", () => {
    const topics = suggestTopics({
      cefrLevel: "B2",
      interests: [" chess ", "Chess", "hiking", "", "jazz", "cats"],
    });
    expect(topics.map((t) => t.text)).toEqual([
      "chess",
      "hiking",
      "jazz",
      "travel and places you want to visit",
      "work and career",
      "technology in everyday life",
    ]);
    expect(topics.slice(3).every((t) => t.kind === "stock")).toBe(true);
  });

  test("no level → basic topics", () => {
    expect(suggestTopics({ cefrLevel: null, interests: [] }).map((t) => t.kind)).toEqual([
      "stock",
      "stock",
      "stock",
    ]);
  });
});

describe("mistake pattern", () => {
  test("is stable across case, spacing and edge punctuation", () => {
    expect(conversationPattern("We  was.", "we were")).toBe(
      conversationPattern("we was", "We were!"),
    );
  });
});
