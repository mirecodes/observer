import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { runOnce } from "../src/index";
import type { NtfyMessage } from "../src/notify";
import { STATE_KEY, emptyState } from "../src/state";
import type { State } from "../src/types";
import LIST from "./fixtures/list-20261017.html?raw";

const ALL_OIDS = [586, 585, 584, 578, 562, 195, 186, 154, 124, 122, 121];
const T0 = new Date("2026-10-17T10:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

let page: string;
let listStatus: number;
let ntfyStatus: number;
let sent: NtfyMessage[];
let authHeaders: (string | null)[];

beforeEach(async () => {
  page = LIST;
  listStatus = 200;
  ntfyStatus = 200;
  sent = [];
  authHeaders = [];
  await env.STATE.delete(STATE_KEY);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith(env.LIST_URL)) return new Response(page, { status: listStatus });
    if (url.startsWith(env.NTFY_SERVER)) {
      sent.push(JSON.parse(String(init?.body)) as NtfyMessage);
      authHeaders.push(new Headers(init?.headers).get("Authorization"));
      return new Response("{}", { status: ntfyStatus });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});

afterEach(() => vi.restoreAllMocks());

async function seed(oids: number[], extra: Partial<State> = {}) {
  const seen = Object.fromEntries(oids.map((o) => [String(o), T0.toISOString()]));
  await env.STATE.put(STATE_KEY, JSON.stringify({ ...emptyState(), seen, lastOkAt: T0.toISOString(), ...extra }));
}

async function readState(): Promise<State> {
  return (await env.STATE.get<State>(STATE_KEY, "json"))!;
}

const without = (...oids: number[]) => ALL_OIDS.filter((o) => !oids.includes(o));

describe("run scenarios", () => {
  it("1. first run: start alert only, seen filled", async () => {
    await runOnce(env, T0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: "👀 WOKO 감시 시작", message: "감시 시작: 현재 11건(거주용 1건)", priority: 2 });
    expect(Object.keys((await readState()).seen).map(Number).sort()).toEqual([...ALL_OIDS].sort());
  });

  it("2. no change: no alert, no KV write", async () => {
    await seed(ALL_OIDS);
    const put = vi.spyOn(env.STATE, "put");
    await runOnce(env, at(5));
    expect(sent).toHaveLength(0);
    expect(put).not.toHaveBeenCalled();
  });

  it("2b. lastOkAt alone is refreshed at most hourly", async () => {
    await seed(ALL_OIDS);
    const put = vi.spyOn(env.STATE, "put");
    await runOnce(env, at(55));
    expect(put).not.toHaveBeenCalled();
    await runOnce(env, at(60));
    expect(put).toHaveBeenCalledTimes(1);
    expect((await readState()).lastOkAt).toBe(at(60).toISOString());
  });

  it("3. new residential listing in target window: one priority-5 alert, added to seen", async () => {
    page = LIST.replace("Ab 03.11.2026", "Ab 15.01.2027");
    await seed(without(586));
    await runOnce(env, at(5));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      topic: "test-topic",
      title: "⭐ WOKO 새 매물 — 타이밍 맞음",
      priority: 5,
      click: "https://www.woko.ch/unser-angebot/freie-objekte/detail?oid=586",
      actions: [{ action: "view", label: "상세", url: "https://www.woko.ch/unser-angebot/freie-objekte/detail?oid=586" }],
    });
    expect(sent[0]!.message).toBe(
      "tenant wanted (subtenant, then main tentant after)\nUntermieter gesucht\n📍 Am Wasser 6/15, 8600 Dübendorf\n💰 580 CHF/월\n📅 Ab 15.01.2027",
    );
    expect((await readState()).seen["586"]).toBe(at(5).toISOString());
  });

  it("3b. early listing: priority 3 with negotiation hint", async () => {
    await seed(without(586));
    await runOnce(env, at(5));
    expect(sent[0]).toMatchObject({ title: "🏠 WOKO 새 매물 (참고용)", priority: 3 });
    expect(sent[0]!.message.endsWith("입주일 협상 가능한지 문의해볼 만함")).toBe(true);
  });

  it("4. only a new parking spot: no alert, added to seen", async () => {
    await seed(without(585));
    await runOnce(env, at(5));
    expect(sent).toHaveLength(0);
    expect((await readState()).seen["585"]).toBeDefined();
  });

  it("5. ntfy failure: not added to seen, retried and succeeds next run", async () => {
    await seed(without(586));
    ntfyStatus = 500;
    await runOnce(env, at(5));
    expect(sent).toHaveLength(1);
    expect((await readState()).seen["586"]).toBeUndefined();

    ntfyStatus = 200;
    await runOnce(env, at(10));
    expect(sent).toHaveLength(2);
    expect(sent[1]!.click).toContain("oid=586");
    expect((await readState()).seen["586"]).toBe(at(10).toISOString());
  });

  it("6. zero parsed listings: state preserved, failures counted, alert on 6th only, recovery after", async () => {
    await seed(ALL_OIDS);
    page = "<html><body>Wartung</body></html>";
    for (let i = 1; i <= 7; i++) {
      await runOnce(env, at(5 * i));
      const s = await readState();
      expect(s.consecutiveFailures).toBe(i);
      expect(Object.keys(s.seen)).toHaveLength(ALL_OIDS.length);
      expect(sent).toHaveLength(i < 6 ? 0 : 1);
    }
    expect(sent[0]).toMatchObject({ title: "⚠️ WOKO 감시 이상", priority: 4 });
    expect(sent[0]!.message).toContain("파싱 결과 0건");

    page = LIST;
    await runOnce(env, at(40));
    expect(sent).toHaveLength(2);
    expect(sent[1]!.title).toBe("✅ WOKO 감시 복구");
    const s = await readState();
    expect(s.consecutiveFailures).toBe(0);
    expect(s.lastHealthAlertAt).toBeUndefined();
  });

  it("6b. HTTP errors count as failures and health alerts repeat at most every 6h", async () => {
    await seed(ALL_OIDS, { consecutiveFailures: 5 });
    listStatus = 503;
    await runOnce(env, at(5));
    expect(sent[0]!.message).toContain("HTTP 503");
    await runOnce(env, at(5 + 6 * 60 - 5));
    expect(sent).toHaveLength(1);
    await runOnce(env, at(5 + 6 * 60));
    expect(sent).toHaveLength(2);
  });

  it("7. six new residential listings: one summary alert", async () => {
    page = LIST.replaceAll('data-typ="1"', 'data-typ="0"');
    await seed(without(585, 584, 578, 562, 195, 186));
    await runOnce(env, at(5));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toBe("🏠 WOKO 새 매물 6건 (참고용)");
    expect(sent[0]!.message.split("\n")).toHaveLength(6);
    expect(sent[0]!.click).toBe(env.LIST_URL);
    expect(Object.keys((await readState()).seen)).toHaveLength(ALL_OIDS.length);
  });

  it("prunes only oids missing from the list for more than 30 days", async () => {
    await seed([...ALL_OIDS, 1, 2], { missingSince: { "1": at(-31 * 24 * 60).toISOString() } });
    await runOnce(env, at(5));
    const s = await readState();
    expect(s.seen["1"]).toBeUndefined();
    expect(s.seen["2"]).toBeDefined();
    expect(s.missingSince).toEqual({ "2": at(5).toISOString() });
    expect(Object.keys(s.seen)).toHaveLength(ALL_OIDS.length + 1);
  });
});

describe("ntfy auth", () => {
  it("sends Bearer token only when NTFY_TOKEN is set", async () => {
    await runOnce(env, T0);
    await env.STATE.delete(STATE_KEY);
    await runOnce({ ...env, NTFY_TOKEN: "tk_abc" } as Env, T0);
    expect(authHeaders).toEqual([null, "Bearer tk_abc"]);
  });
});

describe("handlers", () => {
  it("GET /status exposes only the three fields", async () => {
    await seed(ALL_OIDS, { consecutiveFailures: 2 });
    const res = await worker.fetch(new Request("http://w/status"), env);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ lastOkAt: T0.toISOString(), consecutiveFailures: 2, seenCount: ALL_OIDS.length });
    expect(body).not.toContain("test-topic");
  });

  it("other paths are 404", async () => {
    expect((await worker.fetch(new Request("http://w/"), env)).status).toBe(404);
    expect((await worker.fetch(new Request("http://w/run"), env)).status).toBe(404);
  });

  it("scheduled never throws, even with bad config", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      worker.scheduled(createScheduledController(), { ...env, NTFY_TOPIC: "" }),
    ).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });
});
