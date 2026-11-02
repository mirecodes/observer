import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import amiv, { apiUrl } from "../src/modules/amiv";
import vis, { parseRss } from "../src/modules/vis";
import { CONFIG, type ModuleSettings } from "../src/observers/config";
import { loadSender, type Message } from "../src/observers/notify";
import { runModule, type Module } from "../src/observers/observer";
import type { State } from "../src/observers/state";
import AMIV from "./fixtures/amiv-20261102.json?raw";
import VIS from "./fixtures/vis-20261102.xml?raw";

const NOW = new Date("2026-11-02T12:00:00Z");
const LATER = new Date(NOW.getTime() + 5 * 60_000);
const SETTINGS: ModuleSettings = { enabled: true, notify: true, cfg: { priority: 3 } };
const NTFY = { ...CONFIG.notifier, provider: "ntfy" as const, ntfy: { server: "https://ntfy.test" } };

let amivBody: string;
let visBody: string;
let sent: (Message & { topic: string })[];

beforeEach(async () => {
  amivBody = AMIV;
  visBody = VIS;
  sent = [];
  await env.STATE.delete(amiv.stateKey);
  await env.STATE.delete(vis.stateKey);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://api.amiv.ethz.ch/events?")) return new Response(amivBody);
    if (url === "https://vis.ethz.ch/en/events/rss.xml") return new Response(visBody);
    if (url.startsWith("https://ntfy.test")) {
      sent.push(JSON.parse(String(init?.body)));
      return new Response("{}");
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});

afterEach(() => vi.restoreAllMocks());

const run = <T>(m: Module<T>, now: Date) => runModule(m, SETTINGS, env, loadSender(env, NTFY), now);
const readState = async (m: Module<unknown>) => (await env.STATE.get<State>(m.stateKey, "json"))!;

// 첫 실행으로 현재 목록을 seen 에 채운 뒤 하나를 지워서 "새로 올라온" 상황을 만든다
async function runWithNew<T>(m: Module<T>, id: string) {
  await run(m, NOW);
  const s = await readState(m as Module<unknown>);
  delete s.seen[id];
  await env.STATE.put(m.stateKey, JSON.stringify(s));
  sent = [];
  await run(m, LATER);
}

describe("AMIV", () => {
  it("asks the API for currently advertised website events only", () => {
    const url = decodeURIComponent(apiUrl(new Date("2026-11-02T12:00:00.123Z")));
    expect(url).toContain('"show_website":true');
    expect(url).toContain('"time_advertising_start":{"$lte":"2026-11-02T12:00:00Z"}');
    expect(url).toContain('"time_advertising_end":{"$gte":"2026-11-02T12:00:00Z"}');
  });

  it("first run: start alert only", async () => {
    await run(amiv, NOW);
    expect(sent).toEqual([{ title: "👀 AMIV 감시 시작", message: "감시 시작: 현재 14건", priority: 2, tags: ["amiv"], topic: "test-topic" }]);
    expect(Object.keys((await readState(amiv)).seen)).toHaveLength(14);
  });

  it("new event: one alert with time in Zurich, price and signup start", async () => {
    await runWithNew(amiv, "6ae0ae141d22c5692695449c");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: "🎉 AMIV 새 이벤트", priority: 3, click: "https://amiv.ethz.ch/en/events/6ae0ae141d22c5692695449c" });
    expect(sent[0]!.message.split("\n")).toEqual([
      "TirAMIVsu",
      "Mmmmm",
      "📅 2026. 12. 1. (화) 18:30", // 17:30Z = 취리히 18:30 (CET)
      "📍 CAB D21",
      "💰 10 CHF",
      "📝 신청 시작 2026. 11. 2. (월) 07:00",
    ]);
    expect((await readState(amiv)).seen["6ae0ae141d22c5692695449c"]).toBe(LATER.toISOString());
  });

  it("API error body counts as a failure, seen untouched", async () => {
    await run(amiv, NOW);
    amivBody = '{"_status":"ERR"}';
    await run(amiv, LATER);
    const s = await readState(amiv);
    expect(s.consecutiveFailures).toBe(1);
    expect(Object.keys(s.seen)).toHaveLength(14);
  });
});

describe("VIS", () => {
  it("parses every RSS item", () => {
    const events = parseRss(VIS);
    expect(events).toHaveLength(10);
    expect(events[0]).toEqual({
      link: "https://vis.ethz.ch/en/events/1176",
      title: "VIS x NVIDIA: Tech Talk",
      when: "Nov 3, 2026, 18:15–21:15",
      where: "CAB G 61",
    });
    expect(events.map((e) => e.title)).toContain("VIS x Microsoft AI: Inside Microsoft's Spatial AI Lab");
  });

  it("new event: one alert", async () => {
    await runWithNew(vis, "https://vis.ethz.ch/en/events/1176");
    expect(sent).toEqual([{
      title: "🎉 VIS 새 이벤트",
      message: "VIS x NVIDIA: Tech Talk\n📅 Nov 3, 2026, 18:15–21:15\n📍 CAB G 61",
      priority: 3,
      tags: ["vis"],
      click: "https://vis.ethz.ch/en/events/1176",
      topic: "test-topic",
    }]);
  });

  it("empty feed is fine (semester break), non-RSS is a failure", async () => {
    visBody = VIS.replace(/<item>[\s\S]*<\/item>/, "");
    await run(vis, NOW);
    expect((await readState(vis)).consecutiveFailures).toBe(0);
    // 빈 피드로 첫 실행을 마쳤으니 그 뒤 올라온 이벤트는 알린다
    visBody = VIS;
    await run(vis, LATER);
    expect(sent.at(-1)!.title).toBe("🔔 VIS 새 소식 10건");

    visBody = "<html>maintenance</html>";
    await run(vis, new Date(LATER.getTime() + 5 * 60_000));
    expect((await readState(vis)).consecutiveFailures).toBe(1);
  });
});
