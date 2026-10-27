import { describe, expect, test } from "bun:test";
import {
  encodeSizeTestCallback,
  parseSizeTestCallback,
  type SizeTestCallback,
} from "../../src/sizetest/callbacks";

describe("size test callbacks", () => {
  const cases: SizeTestCallback[] = [
    { type: "start" },
    { type: "stop" },
    { type: "answer", item: 0, option: 3 },
    { type: "answer", item: 44, option: null },
  ];
  for (const callback of cases) {
    test(`round-trips ${JSON.stringify(callback)}`, () => {
      expect(parseSizeTestCallback(encodeSizeTestCallback(callback))).toEqual(callback);
    });
  }

  test("rejects foreign and malformed data", () => {
    for (const data of [
      undefined,
      "",
      "1:g:x",
      "0:z:s",
      "1:z:a:1",
      "1:z:a:x:1",
      "1:z:a:1:q",
      "1:z:s:1",
    ]) {
      expect(parseSizeTestCallback(data)).toBeUndefined();
    }
  });
});
