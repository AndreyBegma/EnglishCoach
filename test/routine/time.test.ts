import { describe, expect, test } from "bun:test";
import {
  dailyPattern,
  localDate,
  minutesOf,
  nextFire,
  safeZone,
  slotDate,
  slotSchedules,
} from "../../src/routine/time";

const at = (iso: string) => new Date(iso);
const schedulesOf = (timezone: string, morningTime = "08:30", eveningTime = "20:00") =>
  Object.fromEntries(
    slotSchedules({ timezone, morningTime, eveningTime }).map((s) => [s.slot, s]),
  ) as Record<"morning" | "evening" | "reminder", ReturnType<typeof slotSchedules>[number]>;

describe("time of day", () => {
  test("parses time columns with and without seconds", () => {
    expect(minutesOf("08:30")).toBe(510);
    expect(minutesOf("20:00:00")).toBe(1200);
    expect(() => minutesOf("24:00")).toThrow();
  });

  test("daily patterns wrap past midnight", () => {
    expect(dailyPattern(510)).toBe("30 8 * * *");
    expect(dailyPattern(23 * 60 + 120)).toBe("0 1 * * *");
  });

  test("an unknown zone falls back to UTC", () => {
    expect(safeZone("Mars/Olympus")).toBe("UTC");
    expect(safeZone("Europe/Kyiv")).toBe("Europe/Kyiv");
  });
});

describe("next fire time", () => {
  test("Europe/Kyiv in summer (UTC+3) and winter (UTC+2)", () => {
    const { morning } = schedulesOf("Europe/Kyiv");
    expect(nextFire(morning, at("2026-07-01T00:00:00Z")).toISOString()).toBe(
      "2026-07-01T05:30:00.000Z",
    );
    expect(nextFire(morning, at("2026-12-01T00:00:00Z")).toISOString()).toBe(
      "2026-12-01T06:30:00.000Z",
    );
  });

  test("Europe/Kyiv across the autumn DST change keeps 08:30 local", () => {
    // Clocks go back on 2026-10-25 at 04:00 local.
    const { morning } = schedulesOf("Europe/Kyiv");
    const saturday = nextFire(morning, at("2026-10-24T00:00:00Z"));
    const sunday = nextFire(morning, saturday);
    const monday = nextFire(morning, sunday);
    expect(saturday.toISOString()).toBe("2026-10-24T05:30:00.000Z");
    expect(sunday.toISOString()).toBe("2026-10-25T06:30:00.000Z");
    expect(monday.toISOString()).toBe("2026-10-26T06:30:00.000Z");
    // A 25-hour day between the two DST-straddling fires.
    expect(sunday.getTime() - saturday.getTime()).toBe(25 * 3_600_000);
  });

  test("America/New_York across the spring DST change keeps 20:00 local", () => {
    // Clocks go forward on 2026-03-08 at 02:00 local.
    const { evening } = schedulesOf("America/New_York");
    const saturday = nextFire(evening, at("2026-03-07T12:00:00Z"));
    const sunday = nextFire(evening, saturday);
    expect(saturday.toISOString()).toBe("2026-03-08T01:00:00.000Z");
    expect(sunday.toISOString()).toBe("2026-03-09T00:00:00.000Z");
    expect(sunday.getTime() - saturday.getTime()).toBe(23 * 3_600_000);
  });

  test("Australia/Sydney: southern-hemisphere DST starts in October", () => {
    // Clocks go forward on 2026-10-04 at 02:00 local (UTC+10 → UTC+11).
    const { morning } = schedulesOf("Australia/Sydney", "07:00");
    const saturday = nextFire(morning, at("2026-10-02T12:00:00Z"));
    const sunday = nextFire(morning, saturday);
    expect(saturday.toISOString()).toBe("2026-10-02T21:00:00.000Z");
    expect(sunday.toISOString()).toBe("2026-10-03T20:00:00.000Z");
    expect(sunday.getTime() - saturday.getTime()).toBe(23 * 3_600_000);
  });

  test("Asia/Kolkata: a half-hour offset and no DST", () => {
    const { morning } = schedulesOf("Asia/Kolkata", "09:00");
    expect(nextFire(morning, at("2026-03-08T00:00:00Z")).toISOString()).toBe(
      "2026-03-08T03:30:00.000Z",
    );
  });

  test("a reminder after a 23:00 evening fires at 01:00 the next local day", () => {
    const { reminder } = schedulesOf("Europe/Kyiv", "08:30", "23:00");
    expect(reminder.pattern).toBe("0 1 * * *");
    const fired = nextFire(reminder, at("2026-07-01T12:00:00Z"));
    expect(fired.toISOString()).toBe("2026-07-01T22:00:00.000Z");
    expect(localDate(fired, "Europe/Kyiv")).toBe("2026-07-02");
    // …and judges the evening it belongs to.
    expect(slotDate("reminder", fired, "Europe/Kyiv")).toBe("2026-07-01");
  });
});

describe("user-local dates", () => {
  test("the same instant is a different day in different zones", () => {
    const instant = at("2026-07-01T22:30:00Z");
    expect(localDate(instant, "UTC")).toBe("2026-07-01");
    expect(localDate(instant, "Europe/Kyiv")).toBe("2026-07-02");
    expect(localDate(instant, "America/New_York")).toBe("2026-07-01");
  });
});
