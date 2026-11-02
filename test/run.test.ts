import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { MODULES } from "../src/modules";
import woko, { LIST_URL } from "../src/modules/woko";
import { CONFIG, type ModuleSettings } from "../src/observers/config";
import { loadSender, type Message } from "../src/observers/notify";
import { runModule } from "../src/observers/observer";
import { emptyState, type State } from "../src/observers/state";
import LIST from "./fixtures/list-20261017.html?raw";

// 테스트는 사용자 설정(cfg.yml)과 무관하게 고정값을 쓴다. 공통 점검 기준만 cfgs/modules.yml 을 따른다
const SETTINGS: ModuleSettings = { enabled: true, notify: true, cfg: { targetFrom: "2026-12-10", targetTo: "2027-02-15" } };
const NTFY = { ...CONFIG.notifier, provider: "ntfy" as const, ntfy: { server: "https://ntfy.test" } };
const { failuresBeforeAlert: N, realertHours } = CONFIG.health;
const STATE_KEY = woko.stateKey;

const runOnce = (e: Env, now: Date, settings: Partial<ModuleSettings> = {}) =>
  runModule(woko, { ...SETTINGS, ...settings }, e, loadSender(e, NTFY), now);

const ALL_OIDS = [586, 585, 584, 578, 562, 195, 186, 154, 124, 122, 121];
const T0 = new Date("2026-10-17T10:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const DAY_MIN = 24 * 60;

let page: string;
let listStatus: number;
let ntfyStatus: number;
let sent: (Message & { topic: string })[];
let authHeaders: (string | null)[];

beforeEach(async () => {
  page = LIST;
  listStatus = 200;
  ntfyStatus = 200;
  sent = [];
  authHeaders = [];
  for (const m of Object.values(MODULES)) await env.STATE.delete(m.stateKey);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith(LIST_URL)) return new Response(page, { status: listStatus });
    if (url.startsWith("https://ntfy.test")) {
      sent.push(JSON.parse(String(init?.body)));
      authHeaders.push(new Headers(init?.headers).get("Authorization"));
      return new Response("{}", { status: ntfyStatus });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});

afterEach(() => vi.restoreAllMocks());

async function seed(oids: number[], extra: Partial<State> = {}) {
  const seen = Object.fromEntries(oids.map((o) => [String(o), T0.toISOString()]));
  await env.STATE.put(STATE_KEY, JSON.stringify({ ...emptyState(), seen, lastOkAt: T0.toISOString(), lastNewAt: T0.toISOString(), ...extra }));
}

async function readState(): Promise<State> {
  return (await env.STATE.get<State>(STATE_KEY, "json"))!;
}

const without = (...oids: number[]) => ALL_OIDS.filter((o) => !oids.includes(o));

describe("run scenarios", () => {
  it("1. first run: start alert only, seen filled", async () => {
    await runOnce(env, T0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: "👀 WOKO 감시 시작", message: "감시 시작: 현재 11건(알림 대상 1건)", priority: 2 });
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
    const s = await readState();
    expect(s.seen["586"]).toBe(at(5).toISOString());
    expect(s.lastNewAt).toBe(at(5).toISOString());
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

  it("4b. notify off: new listing detected and recorded, but no alert", async () => {
    await seed(without(586));
    await runOnce(env, at(5), { notify: false });
    expect(sent).toHaveLength(0);
    const s = await readState();
    expect(s.seen["586"]).toBe(at(5).toISOString());
    expect(s.lastNewAt).toBe(at(5).toISOString());
  });

  it("5. send failure: not added to seen, retried and succeeds next run", async () => {
    await seed(without(586));
    ntfyStatus = 500;
    await runOnce(env, at(5));
    expect(sent).toHaveLength(1);
    expect((await readState()).seen["586"]).toBeUndefined();
    expect((await readState()).unsent).toBe(1);

    ntfyStatus = 200;
    await runOnce(env, at(10));
    expect(sent).toHaveLength(2);
    expect(sent[1]!.click).toContain("oid=586");
    expect((await readState()).seen["586"]).toBe(at(10).toISOString());
    expect((await readState()).unsent).toBeUndefined();
  });

  it("6. zero parsed listings: state preserved, failures counted, check request on Nth only, recovery after", async () => {
    await seed(ALL_OIDS);
    page = "<html><body>Wartung</body></html>";
    for (let i = 1; i <= N + 1; i++) {
      await runOnce(env, at(5 * i));
      const s = await readState();
      expect(s.consecutiveFailures).toBe(i);
      expect(Object.keys(s.seen)).toHaveLength(ALL_OIDS.length);
      expect(sent).toHaveLength(i < N ? 0 : 1);
    }
    expect(sent[0]).toMatchObject({ title: "🛠 WOKO 점검 요청", priority: 4, click: LIST_URL });
    expect(sent[0]!.message).toContain("파싱 결과 0건");

    page = LIST;
    await runOnce(env, at(5 * (N + 2)));
    expect(sent).toHaveLength(2);
    expect(sent[1]!.title).toBe("✅ WOKO 정상화");
    const s = await readState();
    expect(s.consecutiveFailures).toBe(0);
    expect(s.lastHealthAlertAt).toBeUndefined();
  });

  it("6b. HTTP errors count as failures and check requests repeat at most every realertHours", async () => {
    await seed(ALL_OIDS, { consecutiveFailures: N - 1 });
    listStatus = 503;
    await runOnce(env, at(5));
    expect(sent[0]!.message).toContain("HTTP 503");
    await runOnce(env, at(5 + realertHours * 60 - 5));
    expect(sent).toHaveLength(1);
    await runOnce(env, at(5 + realertHours * 60));
    expect(sent).toHaveLength(2);
  });

  it("6c. module error (bad cfg) counts as a failure and leads to a check request", async () => {
    await seed(ALL_OIDS, { consecutiveFailures: N - 1 });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await runOnce(env, at(5), { cfg: { targetFrom: "nope", targetTo: "2027-02-15" } });
    expect(errors).toHaveBeenCalled();
    expect((await readState()).consecutiveFailures).toBe(N);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toBe("🛠 WOKO 점검 요청");
    expect(sent[0]!.message).toContain("모듈 오류: cfg: targetFrom must be yyyy-mm-dd");
  });

  it("6d. stale: no new listing for staleDays → one check request, repeated after staleDays, cleared by a new listing", async () => {
    await seed(ALL_OIDS);
    const stale = { staleDays: 7 };
    await runOnce(env, at(7 * DAY_MIN - 5), stale);
    expect(sent).toHaveLength(0);
    await runOnce(env, at(7 * DAY_MIN), stale);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: "🛠 WOKO 점검 요청", priority: 3, click: LIST_URL });
    expect(sent[0]!.message).toContain("7일째 새 항목이 없습니다");
    await runOnce(env, at(7 * DAY_MIN + 5), stale);
    expect(sent).toHaveLength(1);
    await runOnce(env, at(14 * DAY_MIN), stale);
    expect(sent).toHaveLength(2);

    // 새 매물이 나타나면 기준이 리셋된다
    const s = await readState();
    delete s.seen["585"];
    await env.STATE.put(STATE_KEY, JSON.stringify(s));
    await runOnce(env, at(14 * DAY_MIN + 5), stale);
    const after = await readState();
    expect(after.lastNewAt).toBe(at(14 * DAY_MIN + 5).toISOString());
    expect(after.lastStaleAlertAt).toBeUndefined();
  });

  it("7. six new residential listings: one summary alert", async () => {
    page = LIST.replaceAll('data-typ="1"', 'data-typ="0"');
    await seed(without(585, 584, 578, 562, 195, 186));
    await runOnce(env, at(5));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toBe("🏠 WOKO 새 매물 6건 (참고용)");
    expect(sent[0]!.message.split("\n")).toHaveLength(6);
    expect(sent[0]!.click).toBe(LIST_URL);
    expect(Object.keys((await readState()).seen)).toHaveLength(ALL_OIDS.length);
  });

  it("prunes only oids missing from the list for more than 30 days", async () => {
    await seed([...ALL_OIDS, 1, 2], { missingSince: { "1": at(-31 * DAY_MIN).toISOString() } });
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

describe("config", () => {
  it("every module folder is registered and every enabled module accepts its cfg.yml", () => {
    expect(Object.keys(MODULES).sort()).toEqual(Object.keys(CONFIG.modules).sort());
    for (const [key, mod] of Object.entries(MODULES)) {
      if (CONFIG.modules[key]!.enabled) expect(() => mod.create(CONFIG.modules[key]!.cfg), key).not.toThrow();
    }
  });

  it("module state keys are unique", () => {
    const keys = Object.values(MODULES).map((m) => m.stateKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("handlers", () => {
  it("GET /status: per-module fields, 503 while an enabled module is unhealthy, no secrets", async () => {
    await seed(ALL_OIDS, { consecutiveFailures: 2, unsent: 3 });
    const res = await worker.fetch(new Request("http://w/status"), env);
    const body = await res.text();
    const json = JSON.parse(body);
    expect(Object.keys(json).sort()).toEqual(Object.values(MODULES).map((m) => m.name).sort());
    expect(json.WOKO).toEqual({
      enabled: CONFIG.modules.woko!.enabled,
      notify: CONFIG.modules.woko!.notify,
      ok: false, // T0 는 2시간 넘게 지난 과거
      lastOkAt: T0.toISOString(),
      lastNewAt: T0.toISOString(),
      consecutiveFailures: 2,
      seenCount: ALL_OIDS.length,
      unsent: 3,
    });
    expect(res.status).toBe(503);
    expect(body).not.toContain("test-topic");
  });

  it("GET /status is 200 when every enabled module ran recently", async () => {
    const now = new Date().toISOString();
    for (const m of Object.values(MODULES)) {
      await env.STATE.put(m.stateKey, JSON.stringify({ ...emptyState(), lastOkAt: now }));
    }
    expect((await worker.fetch(new Request("http://w/status"), env)).status).toBe(200);
  });

  it("other paths are 404", async () => {
    expect((await worker.fetch(new Request("http://w/"), env)).status).toBe(404);
    expect((await worker.fetch(new Request("http://w/run"), env)).status).toBe(404);
  });

  it("scheduled never throws, even with bad secrets", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      worker.scheduled(createScheduledController(), { ...env, NTFY_TOPIC: "", PUSHOVER_TOKEN: "" } as Env),
    ).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });
});
