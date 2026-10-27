import { describe, expect, test } from "bun:test";
import type { CardBack } from "../../src/db/schema";
import {
  cardCaption,
  cardHtml,
  MAX_CAPTION,
  type PhotoCredit,
  visibleLength,
} from "../../src/vocab/render";

const t = (key: string, vars: Record<string, string | number> = {}) =>
  key === "vocab-photo-credit"
    ? `📷 ${vars.author} / ${vars.source}`
    : key === "vocab-example-credit"
      ? `💬 Example: ${vars.source} (CC BY 2.0 FR)`
      : key;

const tatoeba = (id: number, author: string | null) => ({
  en: "I borrowed a book from the library.",
  translation: "Я взял книгу в библиотеке.",
  credit: { source: "tatoeba" as const, id, author },
});

const credit: PhotoCredit = {
  source: "pexels",
  authorName: "Ann <Lee>",
  authorUrl: "https://www.pexels.com/@ann?a=1&b=2",
  pageUrl: "https://www.pexels.com/photo/1/",
};

const card = (back: CardBack) => ({ front: "apple", backJson: back });

describe("word card as a photo caption", () => {
  test("word, IPA, translation, the first example and a linked credit", () => {
    const caption = cardCaption(
      t,
      card({
        translation: "яблоко",
        ipa: "/ˈæpl/",
        pos: "noun",
        examples: [
          { en: "I eat an apple.", translation: "Я ем яблоко." },
          { en: "Second.", translation: "Второе." },
        ],
        mnemonic: "not in the caption",
      }),
      credit,
      "✅ Right",
    );
    expect(caption).toBe(
      [
        "✅ Right",
        "",
        "<b>apple</b> /ˈæpl/ · <i>noun</i>",
        "яблоко",
        "",
        "• I eat an apple.",
        "",
        '📷 <a href="https://www.pexels.com/@ann?a=1&amp;b=2">Ann &lt;Lee&gt;</a> / <a href="https://www.pexels.com/photo/1/">Pexels</a>',
      ].join("\n"),
    );
  });

  test("too long: the example is cut first, to exactly the limit", () => {
    const caption = cardCaption(
      t,
      card({ translation: "x".repeat(300), examples: [{ en: "y".repeat(2000), translation: "" }] }),
      credit,
    );
    expect(caption).toBeDefined();
    expect(visibleLength(caption ?? "")).toBe(MAX_CAPTION);
    expect(caption).toContain("x".repeat(300));
    expect(caption).toContain("…");
  });

  test("too long even without the example: no caption, the text card is shown", () => {
    const caption = cardCaption(t, card({ translation: "x".repeat(1100) }), credit);
    expect(caption).toBeUndefined();
  });

  test("a Tatoeba example brings its CC BY attribution, linked to the sentence", () => {
    const caption = cardCaption(t, card({ translation: "брать", examples: [tatoeba(1, "a<b")] }), {
      ...credit,
      authorName: "Ann",
    });
    expect(caption).toBe(
      [
        "<b>apple</b>",
        "брать",
        "",
        "• I borrowed a book from the library.",
        "",
        '💬 Example: <a href="https://tatoeba.org/en/sentences/show/1">Tatoeba / a&lt;b</a> (CC BY 2.0 FR)',
        '📷 <a href="https://www.pexels.com/@ann?a=1&amp;b=2">Ann</a> / <a href="https://www.pexels.com/photo/1/">Pexels</a>',
      ].join("\n"),
    );
  });

  test("a Tatoeba example cut to fit: the attribution counts against the limit", () => {
    const long = { ...tatoeba(7, null), en: "y".repeat(2000) };
    const caption = cardCaption(
      t,
      card({ translation: "x".repeat(300), examples: [long] }),
      credit,
    );
    expect(visibleLength(caption ?? "")).toBe(MAX_CAPTION);
    expect(caption).toContain("Tatoeba #7");
    expect(caption).toContain("…");
  });

  test("no room for the example: neither it nor its attribution is shown", () => {
    const caption = cardCaption(
      t,
      card({ translation: "x".repeat(MAX_CAPTION - 80), examples: [tatoeba(1, null)] }),
      credit,
    );
    expect(caption).toBeDefined();
    expect(caption).not.toContain("Tatoeba");
  });

  test("the text card credits each Tatoeba example and none written by the model", () => {
    const html = cardHtml(
      t,
      card({ examples: [tatoeba(1, "alice"), { en: "Model one.", translation: "м" }] }),
    );
    expect(html).toContain(
      '💬 Example: <a href="https://tatoeba.org/en/sentences/show/1">Tatoeba / alice</a> (CC BY 2.0 FR)',
    );
    expect(html.match(/tatoeba\.org/g)).toHaveLength(1);
  });

  test("an abstract word's emoji leads the text card", () => {
    expect(cardHtml(t, card({ emoji: "🤔", ipa: "/ˈæpl/" }))).toStartWith("🤔 <b>apple</b> /ˈæpl/");
  });
});
