import type { Listing, State } from "./types";

// KV 접근은 이 파일에서만 한다.
export const STATE_KEY = "state:v1";
const PRUNE_AFTER_MS = 30 * 24 * 3600_000;

export function emptyState(): State {
  return { version: 1, seen: {}, missingSince: {}, consecutiveFailures: 0 };
}

// 없거나 깨졌으면 null -> 호출 측에서 첫 실행으로 처리 (알림 폭주 대신 시작 알림 1건)
export async function loadState(kv: KVNamespace): Promise<State | null> {
  const raw = await kv.get<Partial<State>>(STATE_KEY, "json").catch((e: unknown) => {
    console.error("state: unreadable, treating as first run", e);
    return null;
  });
  if (!raw || raw.version !== 1 || typeof raw.seen !== "object" || raw.seen === null) return null;
  return {
    ...emptyState(),
    ...raw,
    missingSince: raw.missingSince ?? {},
    consecutiveFailures: raw.consecutiveFailures ?? 0,
  } as State;
}

export async function saveState(kv: KVNamespace, state: State): Promise<void> {
  await kv.put(STATE_KEY, JSON.stringify(state));
}

export function isFirstRun(state: State): boolean {
  return Object.keys(state.seen).length === 0;
}

export function unseen(state: State, listings: Listing[]): Listing[] {
  return listings.filter((l) => !(String(l.oid) in state.seen));
}

// 목록에서 사라진 oid 에 사라진 시각을 기록하고, 30일 넘게 사라져 있던 oid 만 seen 에서 지운다.
// 목록에 다시 나타나면 기록을 지운다. 목록에 있는 oid 는 절대 지우지 않는다.
export function trackMissing(state: State, currentOids: number[], now: Date): State {
  const current = new Set(currentOids.map(String));
  const seen = { ...state.seen };
  const missingSince: Record<string, string> = {};
  for (const oid of Object.keys(seen)) {
    if (current.has(oid)) continue;
    const since = state.missingSince[oid] ?? now.toISOString();
    if (now.getTime() - Date.parse(since) > PRUNE_AFTER_MS) delete seen[oid];
    else missingSince[oid] = since;
  }
  return { ...state, seen, missingSince };
}
