import { describe, expect, it } from "vitest";
import { classifyTiming } from "../src/classify";
import { isIsoDate, parseAvailableFrom } from "../src/dates";

const timing = (raw: string) => classifyTiming({ availableRaw: raw, availableFrom: parseAvailableFrom(raw) }, "2027-01-01", "2027-02-15");

describe("parseAvailableFrom", () => {
  it("parses 'Ab dd.mm.yyyy'", () => expect(parseAvailableFrom("Ab 03.11.2026")).toBe("2026-11-03"));
  it("returns undefined for 'Ab sofort'", () => expect(parseAvailableFrom("Ab sofort")).toBeUndefined());
  it("uses the start of a range", () => expect(parseAvailableFrom("01.12.2026 - 31.01.2027")).toBe("2026-12-01"));
  it("rejects impossible dates", () => expect(parseAvailableFrom("Ab 31.02.2027")).toBeUndefined());
  it("tolerates whitespace and newlines", () => expect(parseAvailableFrom("\n  Ab  1.2.2027 \n")).toBe("2027-02-01"));
  it("returns undefined for garbage", () => expect(parseAvailableFrom("nach Vereinbarung")).toBeUndefined());
});

describe("isIsoDate", () => {
  it("accepts real dates only", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isIsoDate("2027-1-01")).toBe(false);
  });
});

describe("timing", () => {
  it("handles window boundaries inclusively", () => {
    expect(timing("Ab 31.12.2026")).toBe("early");
    expect(timing("Ab 01.01.2027")).toBe("target");
    expect(timing("Ab 15.02.2027")).toBe("target");
    expect(timing("Ab 16.02.2027")).toBe("late");
  });
  it("treats 'Ab sofort' as early", () => expect(timing("Ab sofort")).toBe("early"));
  it("judges ranges by start date", () => expect(timing("01.12.2026 - 31.01.2027")).toBe("early"));
  it("is unknown when unparsable", () => {
    expect(timing("nach Vereinbarung")).toBe("unknown");
    expect(timing("Ab 31.02.2027")).toBe("unknown");
  });
});
