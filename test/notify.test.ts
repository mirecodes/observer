import { afterEach, describe, expect, it, vi } from "vitest";
import { CONFIG } from "../src/observers/config";
import { loadSender } from "../src/observers/notify";
import { PUSHOVER_URL, toPushover } from "../src/observers/pushover";

const TOKEN = "a".repeat(30);
const USER = "u".repeat(30);
const PUSHOVER = { ...CONFIG.notifier, provider: "pushover" as const, pushover: { sound: "siren" } };

afterEach(() => vi.restoreAllMocks());

describe("pushover", () => {
  it("maps priority, click button and extra links", () => {
    expect(toPushover({
      title: "⭐ WOKO 새 매물",
      message: "Zimmer",
      priority: 5,
      click: "https://d/586",
      actions: [{ action: "view", label: "상세", url: "https://d/586" }, { action: "view", label: "지원하기", url: "https://apply/586" }],
    })).toEqual({ title: "⭐ WOKO 새 매물", message: "Zimmer\n지원하기: https://apply/586", priority: "1", url: "https://d/586", url_title: "상세" });
    expect(toPushover({ title: "t", message: "m", priority: 2 })).toEqual({ title: "t", message: "m", priority: "-1" });
    expect(toPushover({ title: "t", message: "x".repeat(2000), priority: 3 }).message).toHaveLength(1024);
  });

  it("provider switch: posts a form with token, user and sound to the pushover API", async () => {
    const calls: [string, RequestInit][] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      calls.push([String(input), init!]);
      return new Response('{"status":1}');
    });
    const send = loadSender({ PUSHOVER_TOKEN: TOKEN, PUSHOVER_USER: USER, NTFY_TOPIC: "unused" }, PUSHOVER);
    expect(await send({ title: "t", message: "m", priority: 3, tags: ["x"] })).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe(PUSHOVER_URL);
    expect(Object.fromEntries(calls[0]![1].body as URLSearchParams)).toEqual({
      token: TOKEN, user: USER, title: "t", message: "m", priority: "0", sound: "siren",
    });
  });

  it("rejected request returns false without leaking secrets to logs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"status":0,"errors":["user key is invalid"]}', { status: 400 }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = loadSender({ PUSHOVER_TOKEN: TOKEN, PUSHOVER_USER: USER }, PUSHOVER);
    expect(await send({ title: "t", message: "m", priority: 3 })).toBe(false);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(USER);
  });

  it("missing secrets throw a setup hint", () => {
    expect(() => loadSender({}, PUSHOVER)).toThrow("PUSHOVER_TOKEN");
    expect(() => loadSender({ PUSHOVER_TOKEN: TOKEN }, PUSHOVER)).toThrow("PUSHOVER_USER");
  });
});
