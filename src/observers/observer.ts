import { CONFIG, type ModuleSettings } from "./config";
import type { Message, Send } from "./notify";
import { emptyState, loadState, saveState, trackMissing, type State } from "./state";

export type Fetched<T> = { ok: true; items: T[] } | { ok: false; reason: string };

// 감시 대상 하나(src/modules/<이름>/index.ts 가 default export).
// 새 항목 판별, 상태 저장, 점검 요청·복구 알림은 runModule 이 공통으로 처리한다.
export interface Module<T> {
  name: string; // 알림 제목, 로그, /status 키
  stateKey: string; // KV 키
  // cfg 는 그 모듈의 cfg.yml. 잘못된 값이면 throw (→ 실패로 세서 점검 요청)
  create(cfg: Record<string, unknown>): Observer<T>;
}

export interface Observer<T> {
  listUrl: string; // 요약·점검 요청에서 열 페이지
  // 현재 목록 전체. 사이트 개편 등으로 결과를 믿을 수 없으면 ok: false
  fetch(now: Date): Promise<Fetched<T>>;
  id(item: T): string;
  notifiable?(item: T): boolean; // false 면 알림 없이 seen. 없으면 전부 알림
  message(item: T): Message;
  summary?(items: T[]): Message; // 없으면 각 message 의 첫 줄을 모은 기본 요약
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const LAST_OK_RESOLUTION_MS = HOUR; // lastOkAt 만 바뀔 때 KV 쓰기를 시간당 1회로 제한
const SUMMARY_MAX_LINES = 20;

interface Run<T> {
  mod: Module<T>;
  settings: ModuleSettings;
  send: Send;
  now: Date;
  listUrl?: string;
}

const tagsOf = (mod: Module<unknown>) => [mod.name.toLowerCase()];

function defaultSummary<T>(mod: Module<T>, o: Observer<T>, items: T[]): Message {
  const msgs = items.map((i) => o.message(i));
  const lines = msgs.slice(0, SUMMARY_MAX_LINES).map((m) => `• ${m.message.split("\n")[0]}`);
  if (msgs.length > SUMMARY_MAX_LINES) lines.push(`… 외 ${msgs.length - SUMMARY_MAX_LINES}건`);
  return {
    title: `🔔 ${mod.name} 새 소식 ${items.length}건`,
    message: lines.join("\n"),
    priority: Math.max(...msgs.map((m) => m.priority)) as Message["priority"],
    tags: tagsOf(mod),
    click: o.listUrl,
    actions: [{ action: "view", label: "목록 열기", url: o.listUrl }],
  };
}

async function onSuccess<T>(r: Run<T>, o: Observer<T>, state: State, items: T[]): Promise<State> {
  const { mod, send, now } = r;
  const nowIso = now.toISOString();
  const tags = tagsOf(mod);
  const firstRun = !state.lastOkAt;
  state.consecutiveFailures = 0;
  if (!state.lastOkAt || now.getTime() - Date.parse(state.lastOkAt) >= LAST_OK_RESOLUTION_MS) state.lastOkAt = nowIso;

  if (state.lastHealthAlertAt && (await send({ title: `✅ ${mod.name} 정상화`, message: "목록을 다시 정상적으로 읽고 있습니다.", priority: 3, tags }))) {
    delete state.lastHealthAlertAt;
  }

  const notifiable = (i: T) => o.notifiable?.(i) ?? true;

  if (firstRun) {
    for (const i of items) state.seen[o.id(i)] = nowIso;
    state.lastNewAt = nowIso;
    const n = items.filter(notifiable).length;
    const detail = n === items.length ? "" : `(알림 대상 ${n}건)`;
    const muted = r.settings.notify ? "" : "\n새 항목 알림 꺼짐 — 감지·점검만 합니다";
    await send({ title: `👀 ${mod.name} 감시 시작`, message: `감시 시작: 현재 ${items.length}건${detail}${muted}`, priority: 2, tags });
    return trackMissing(state, items.map((i) => o.id(i)), now);
  }

  const unseen = items.filter((i) => !(o.id(i) in state.seen));
  if (unseen.length) {
    state.lastNewAt = nowIso;
    delete state.lastStaleAlertAt;
  }
  const fresh: T[] = [];
  for (const i of unseen) {
    if (r.settings.notify && notifiable(i)) fresh.push(i);
    else state.seen[o.id(i)] = nowIso; // 알림 대상 아님(예: WOKO 주차장) 또는 알림 꺼짐 → 바로 seen
  }

  // seen 추가는 알림 전송 성공 후에만. 실패한 항목은 다음 실행에서 다시 시도된다.
  if (fresh.length > CONFIG.maxSingleAlerts) {
    if (await send(o.summary?.(fresh) ?? defaultSummary(mod, o, fresh))) {
      for (const i of fresh) state.seen[o.id(i)] = nowIso;
    }
  } else {
    for (const i of fresh) {
      if (await send(o.message(i))) state.seen[o.id(i)] = nowIso;
    }
  }
  // 0 이면 undefined → JSON 에서 빠지므로 정상 상태에선 KV 쓰기가 늘지 않는다
  state.unsent = fresh.filter((i) => !(o.id(i) in state.seen)).length || undefined;

  await checkStale(r, state);
  return trackMissing(state, items.map((i) => o.id(i)), now);
}

// 목록은 잘 읽히는데 새 항목이 오래 없으면, 사이트가 바뀌어 새 항목을 놓치고 있을 수 있다
async function checkStale<T>(r: Run<T>, state: State): Promise<void> {
  const days = r.settings.staleDays;
  if (!days) return;
  const now = r.now.getTime();
  state.lastNewAt ??= r.now.toISOString(); // 이 기능 이전 상태: 지금부터 잰다
  const quietDays = Math.floor((now - Date.parse(state.lastNewAt)) / DAY);
  const lastAlert = state.lastStaleAlertAt ? Date.parse(state.lastStaleAlertAt) : undefined;
  if (
    quietDays >= days &&
    (lastAlert === undefined || now - lastAlert >= days * DAY) &&
    (await r.send({
      title: `🛠 ${r.mod.name} 점검 요청`,
      message: `${quietDays}일째 새 항목이 없습니다. 목록은 읽히지만 사이트가 바뀌어 새 항목을 놓치고 있을 수 있으니 확인해 주세요.`,
      priority: 3,
      tags: tagsOf(r.mod),
      click: r.listUrl,
    }))
  ) {
    state.lastStaleAlertAt = r.now.toISOString();
  }
}

// 실패 시 seen 은 건드리지 않는다. 카운터만 올리고 필요하면 점검 요청.
async function onFailure<T>(r: Run<T>, state: State, reason: string): Promise<State> {
  const { failuresBeforeAlert, realertHours } = CONFIG.health;
  state.consecutiveFailures += 1;
  console.error(`${r.mod.name}: run failed (${state.consecutiveFailures} in a row): ${reason}`);
  const last = state.lastHealthAlertAt ? Date.parse(state.lastHealthAlertAt) : undefined;
  if (
    state.consecutiveFailures >= failuresBeforeAlert &&
    (last === undefined || r.now.getTime() - last >= realertHours * HOUR) &&
    (await r.send({
      title: `🛠 ${r.mod.name} 점검 요청`,
      message: `연속 ${state.consecutiveFailures}회 실패 (약 ${state.consecutiveFailures * 5}분)\n원인: ${reason}`,
      priority: 4,
      tags: tagsOf(r.mod),
      click: r.listUrl,
    }))
  ) {
    state.lastHealthAlertAt = r.now.toISOString();
  }
  return state;
}

export async function runModule<T>(mod: Module<T>, settings: ModuleSettings, env: Env, send: Send, now = new Date()): Promise<void> {
  const prev = await loadState(env.STATE, mod.stateKey);
  const before = JSON.stringify(prev);
  const fresh = () => (prev ? structuredClone(prev) : emptyState());
  const r: Run<T> = { mod, settings, send, now };

  let next: State;
  try {
    const o = mod.create(settings.cfg);
    r.listUrl = o.listUrl;
    const res = await o.fetch(now);
    next = res.ok ? await onSuccess(r, o, fresh(), res.items) : await onFailure(r, fresh(), res.reason);
  } catch (e) {
    // 설정 오류·코드 버그도 실패로 센다. 도중에 바뀐 상태는 버리고 이전 상태에서 다시
    const reason = `모듈 오류: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
    next = await onFailure(r, fresh(), reason);
  }

  // 상태가 실제로 바뀐 실행에서만 KV 에 쓴다 (무료 플랜 쓰기 한도)
  if (JSON.stringify(next) !== before) await saveState(env.STATE, mod.stateKey, next);
}
