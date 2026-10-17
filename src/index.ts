import { classifyTiming, isNotifiable } from "./classify";
import { loadConfig } from "./config";
import { fetchList } from "./fetchList";
import {
  healthMessage, listingMessage, recoveryMessage, send, startMessage, summaryMessage, type Item,
} from "./notify";
import { parseListings } from "./parse";
import { emptyState, isFirstRun, loadState, saveState, trackMissing, unseen } from "./state";
import type { Config, Listing, State } from "./types";

const HOUR = 3600_000;
const FAILURES_BEFORE_ALERT = 6; // 5분 x 6 = 약 30분
const HEALTH_REALERT_MS = 6 * HOUR;
const LAST_OK_RESOLUTION_MS = HOUR; // lastOkAt 만 바뀔 때 KV 쓰기를 시간당 1회로 제한
const MAX_SINGLE_ALERTS = 5;

async function onSuccess(cfg: Config, state: State, listings: Listing[], now: Date): Promise<State> {
  const nowIso = now.toISOString();
  state.consecutiveFailures = 0;
  if (!state.lastOkAt || now.getTime() - Date.parse(state.lastOkAt) >= LAST_OK_RESOLUTION_MS) state.lastOkAt = nowIso;

  if (state.lastHealthAlertAt && (await send(cfg,recoveryMessage(cfg.ntfyTopic)))) {
    delete state.lastHealthAlertAt;
  }

  if (isFirstRun(state)) {
    for (const l of listings) state.seen[l.oid] = nowIso;
    const residential = listings.filter((l) => isNotifiable(l.category)).length;
    await send(cfg,startMessage(cfg.ntfyTopic, listings.length, residential));
    return state;
  }

  const items: Item[] = [];
  for (const l of unseen(state, listings)) {
    if (isNotifiable(l.category)) items.push({ listing: l, timing: classifyTiming(l, cfg.targetFrom, cfg.targetTo) });
    else state.seen[l.oid] = nowIso; // 주차장·상업 공간은 알림 없이 바로 seen
  }

  // seen 추가는 알림 전송 성공 후에만. 실패한 매물은 다음 실행에서 다시 시도된다.
  if (items.length > MAX_SINGLE_ALERTS) {
    if (await send(cfg,summaryMessage(cfg.ntfyTopic, items, cfg.listUrl))) {
      for (const i of items) state.seen[i.listing.oid] = nowIso;
    }
  } else {
    for (const i of items) {
      if (await send(cfg,listingMessage(cfg.ntfyTopic, i))) state.seen[i.listing.oid] = nowIso;
    }
  }

  return trackMissing(state, listings.map((l) => l.oid), now);
}

// 실패 시 seen 은 건드리지 않는다. 카운터만 올리고 필요하면 장애 알림.
async function onFailure(cfg: Config, state: State, reason: string, now: Date): Promise<State> {
  state.consecutiveFailures += 1;
  console.error(`run failed (${state.consecutiveFailures} in a row): ${reason}`);
  const last = state.lastHealthAlertAt ? Date.parse(state.lastHealthAlertAt) : undefined;
  if (
    state.consecutiveFailures >= FAILURES_BEFORE_ALERT &&
    (last === undefined || now.getTime() - last >= HEALTH_REALERT_MS) &&
    (await send(cfg,healthMessage(cfg.ntfyTopic, state.consecutiveFailures, reason, cfg.listUrl)))
  ) {
    state.lastHealthAlertAt = now.toISOString();
  }
  return state;
}

export async function runOnce(env: Env, now = new Date()): Promise<void> {
  const cfg = loadConfig(env);
  const prev = await loadState(env.STATE);
  const before = JSON.stringify(prev);
  const state = prev ? structuredClone(prev) : emptyState();

  const res = await fetchList(cfg.listUrl);
  const listings = res.ok ? parseListings(res.html, cfg.listUrl) : [];
  const next =
    !res.ok ? await onFailure(cfg, state, res.reason, now)
    : listings.length === 0 ? await onFailure(cfg, state, "파싱 결과 0건 (사이트 마크업 변경 의심)", now)
    : await onSuccess(cfg, state, listings, now);

  // 상태가 실제로 바뀐 실행에서만 KV 에 쓴다 (무료 플랜 쓰기 한도)
  if (JSON.stringify(next) !== before) await saveState(env.STATE, next);
}

export default {
  async scheduled(controller, env) {
    try {
      await runOnce(env, new Date(controller.scheduledTime));
    } catch (e) {
      console.error("scheduled: unhandled error", e);
    }
  },

  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method !== "GET" || url.pathname !== "/status") return new Response("Not found", { status: 404 });
    const s = await loadState(env.STATE);
    return Response.json({
      lastOkAt: s?.lastOkAt ?? null,
      consecutiveFailures: s?.consecutiveFailures ?? 0,
      seenCount: s ? Object.keys(s.seen).length : 0,
    });
  },
} satisfies ExportedHandler<Env>;
