// KV 접근은 이 파일에서만 한다. 감시 대상마다 키 하나.
const PRUNE_AFTER_MS = 30 * 24 * 3600_000;

export interface State {
  version: 1;
  seen: Record<string, string>; // id -> 처음 본 ISO 시각
  // 목록에서 사라진 id -> 처음 사라진 ISO 시각. 30일 prune 기준.
  missingSince: Record<string, string>;
  lastOkAt?: string; // 한 번도 성공한 적 없으면 없음 = 첫 실행
  consecutiveFailures: number;
  lastHealthAlertAt?: string;
  lastNewAt?: string; // 마지막으로 새 항목(알림 대상 아닌 것 포함)을 본 시각. staleDays 기준
  lastStaleAlertAt?: string;
  unsent?: number; // 알림 전송에 실패해 다음 실행을 기다리는 항목 수. 0이면 키 자체가 없다
}

export function emptyState(): State {
  return { version: 1, seen: {}, missingSince: {}, consecutiveFailures: 0 };
}

// 없거나 깨졌으면 null -> 호출 측에서 첫 실행으로 처리 (알림 폭주 대신 시작 알림 1건)
export async function loadState(kv: KVNamespace, key: string): Promise<State | null> {
  const raw = await kv.get<Partial<State>>(key, "json").catch((e: unknown) => {
    console.error(`state(${key}): unreadable, treating as first run`, e);
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

export async function saveState(kv: KVNamespace, key: string, state: State): Promise<void> {
  await kv.put(key, JSON.stringify(state));
}

// 목록에서 사라진 id 에 사라진 시각을 기록하고, 30일 넘게 사라져 있던 id 만 seen 에서 지운다.
// 목록에 다시 나타나면 기록을 지운다. 목록에 있는 id 는 절대 지우지 않는다.
export function trackMissing(state: State, currentIds: string[], now: Date): State {
  const current = new Set(currentIds);
  const seen = { ...state.seen };
  const missingSince: Record<string, string> = {};
  for (const id of Object.keys(seen)) {
    if (current.has(id)) continue;
    const since = state.missingSince[id] ?? now.toISOString();
    if (now.getTime() - Date.parse(since) > PRUNE_AFTER_MS) delete seen[id];
    else missingSince[id] = since;
  }
  return { ...state, seen, missingSince };
}
