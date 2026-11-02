import { MODULES } from "./modules";
import { CONFIG } from "./observers/config";
import { loadSender } from "./observers/notify";
import { runModule } from "./observers/observer";
import { loadState } from "./observers/state";

const HOUR = 3600_000;
// lastOkAt 은 시간 단위로만 갱신되므로 2시간 넘게 안 바뀌었으면 크론이 멈췄거나 계속 실패 중
const STATUS_STALE_MS = 2 * HOUR;

const enabled = () => Object.entries(MODULES).filter(([key]) => CONFIG.modules[key]?.enabled);

// 한 모듈의 실패가 다른 모듈을 막지 않는다
export async function runAll(env: Env, now = new Date()): Promise<void> {
  const send = loadSender(env, CONFIG.notifier);
  await Promise.all(
    enabled().map(([key, mod]) =>
      runModule(mod, CONFIG.modules[key]!, env, send, now).catch((e) => console.error(`${mod.name}: unhandled error`, e)),
    ),
  );
}

export default {
  async scheduled(controller, env) {
    try {
      await runAll(env, new Date(controller.scheduledTime));
    } catch (e) {
      console.error("scheduled: unhandled error", e);
    }
  },

  // 켜진 모듈 중 하나라도 이상하면 503 → 외부 업타임 모니터로 "크론 자체가 멈춤"도 잡을 수 있다
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method !== "GET" || url.pathname !== "/status") return new Response("Not found", { status: 404 });
    const now = Date.now();
    const out: Record<string, unknown> = {};
    let allOk = true;
    for (const [key, mod] of Object.entries(MODULES)) {
      const { enabled: on = false, notify = false } = CONFIG.modules[key] ?? {};
      const s = await loadState(env.STATE, mod.stateKey);
      const ok = !on || (!!s?.lastOkAt && now - Date.parse(s.lastOkAt) < STATUS_STALE_MS && s.consecutiveFailures < CONFIG.health.failuresBeforeAlert);
      allOk &&= ok;
      out[mod.name] = {
        enabled: on,
        notify,
        ok,
        lastOkAt: s?.lastOkAt ?? null,
        lastNewAt: s?.lastNewAt ?? null,
        consecutiveFailures: s?.consecutiveFailures ?? 0,
        seenCount: s ? Object.keys(s.seen).length : 0,
        unsent: s?.unsent ?? 0,
      };
    }
    return Response.json(out, { status: allOk ? 200 : 503 });
  },
} satisfies ExportedHandler<Env>;
