import type { NativeLanguage } from "./context";

// Curated, server-owned notes on the errors speakers of each language make most in English.
// They go into system prompts, so they must never contain learner text.

const SLAVIC_COMMON = [
  "Articles: there are none in the native language, so a/an/the are dropped or misused ('I bought car', 'the life is hard').",
  "Present perfect vs past simple: past simple used for life experience and unfinished periods ('I live here since 2020', 'Did you ever be in London?').",
  "Auxiliary 'do' and question word order: 'Where you work?', 'Why he is late?'.",
  "Present tense in time and condition clauses: 'when I will come home' instead of 'when I come home'.",
  "Prepositions of time and place: 'in Monday', 'at the morning', 'arrive to the airport'.",
  "Uncountable nouns used as countable: 'an advice', 'informations', 'the news are'.",
  "Double negatives copied from the native grammar: 'Nobody didn't call'.",
  "'Explain me', 'I am agree', 'it depends from', 'married with': verb patterns translated word for word.",
  "say/tell, make/do, borrow/lend, lose/miss confused because one native verb covers both.",
  "Pronunciation: th as /s/ /z/ or /f/, w as /v/, short/long vowel pairs merged (ship/sheep, full/fool), final voiced consonants devoiced (bed→bet).",
];

const HINTS: Record<NativeLanguage, string> = {
  ru: [
    "The learner's native language is Russian. Typical Russian-speaker errors in English:",
    ...SLAVIC_COMMON.map((line) => `- ${line}`),
    "- Dropped 'to be' in the present: 'He student', 'She very tired'.",
    "- False friends: magazine (магазин = shop), accurate (аккуратный = tidy), sympathetic (симпатичный = good-looking), artist (артист = performer), fabric (фабрика = factory).",
    "- Calques: 'How it is called?', 'I very like it', 'It is not depend on me'.",
  ].join("\n"),
  uk: [
    "The learner's native language is Ukrainian. Typical Ukrainian-speaker errors in English:",
    ...SLAVIC_COMMON.map((line) => `- ${line}`),
    "- Dropped 'to be' in the present: 'He student', 'She very tired'.",
    "- Calques of 'мені 20 років' and 'мені подобається': 'I have 20 years', 'To me it likes'.",
    "- False friends: magazine (магазин = shop), actual (актуальний = relevant, current), complexion (комплекція = build), fabric (фабрика = factory), accurate (акуратний = tidy).",
    "- Pronunciation: English /h/ and /g/ blurred with Ukrainian г /ɦ/ ('hood' vs 'good').",
  ].join("\n"),
};

const UNKNOWN =
  "The learner's native language is not known. Aim tips at errors common to most learners at this level, and do not assume a native language.";

export function nativeHints(lang: NativeLanguage | null): string {
  return lang ? HINTS[lang] : UNKNOWN;
}
