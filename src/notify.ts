import type { Config, Listing, Timing } from "./types";

// docs.ntfy.sh/publish "Publish as JSON"
export interface NtfyMessage {
  topic: string;
  title: string;
  message: string;
  priority: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  click?: string;
  actions?: { action: "view"; label: string; url: string }[];
}

export interface Item {
  listing: Listing;
  timing: Timing;
}

const SUMMARY_MAX_LINES = 20;

const isUrgent = (t: Timing) => t === "target" || t === "unknown";

function rentText(l: Listing): string | undefined {
  return l.rentChf === undefined ? undefined : `${l.rentChf} CHF/월`;
}

export function listingMessage(topic: string, { listing: l, timing }: Item): NtfyMessage {
  const where = [l.address, l.place].filter(Boolean).join(", ");
  const rent = rentText(l);
  const lines = [
    l.title,
    l.badge,
    where && `📍 ${where}`,
    rent && `💰 ${rent}`,
    `📅 ${l.availableRaw || "(입주일 표기 없음)"}`,
    !isUrgent(timing) && "입주일 협상 가능한지 문의해볼 만함",
  ];
  const actions: NonNullable<NtfyMessage["actions"]> = [{ action: "view", label: "상세", url: l.detailUrl }];
  if (l.applyUrl) actions.push({ action: "view", label: "지원하기", url: l.applyUrl });
  return {
    topic,
    title:
      timing === "target" ? "⭐ WOKO 새 매물 — 타이밍 맞음"
      : timing === "unknown" ? "⭐ WOKO 새 매물 — 날짜 확인 필요"
      : "🏠 WOKO 새 매물 (참고용)",
    message: lines.filter(Boolean).join("\n"),
    priority: isUrgent(timing) ? 5 : 3,
    tags: ["woko"],
    click: l.detailUrl,
    actions,
  };
}

export function summaryMessage(topic: string, items: Item[], listUrl: string): NtfyMessage {
  const urgent = items.some((i) => isUrgent(i.timing));
  const lines = items.slice(0, SUMMARY_MAX_LINES).map(({ listing: l, timing }) =>
    [`${isUrgent(timing) ? "⭐" : "•"} ${l.title}`, l.place, rentText(l), l.availableRaw].filter(Boolean).join(" — "),
  );
  if (items.length > SUMMARY_MAX_LINES) lines.push(`… 외 ${items.length - SUMMARY_MAX_LINES}건`);
  return {
    topic,
    title: urgent ? `⭐ WOKO 새 매물 ${items.length}건` : `🏠 WOKO 새 매물 ${items.length}건 (참고용)`,
    message: lines.join("\n"),
    priority: urgent ? 5 : 3,
    tags: ["woko"],
    click: listUrl,
    actions: [{ action: "view", label: "목록 열기", url: listUrl }],
  };
}

export function startMessage(topic: string, total: number, residential: number): NtfyMessage {
  return { topic, title: "👀 WOKO 감시 시작", message: `감시 시작: 현재 ${total}건(거주용 ${residential}건)`, priority: 2, tags: ["woko"] };
}

export function healthMessage(topic: string, failures: number, reason: string, listUrl: string): NtfyMessage {
  return {
    topic,
    title: "⚠️ WOKO 감시 이상",
    message: `연속 ${failures}회 실패 (약 ${failures * 5}분)\n원인: ${reason}`,
    priority: 4,
    tags: ["woko"],
    click: listUrl,
  };
}

export function recoveryMessage(topic: string): NtfyMessage {
  return { topic, title: "✅ WOKO 감시 복구", message: "목록을 다시 정상적으로 읽고 있습니다.", priority: 3, tags: ["woko"] };
}

// 성공(2xx)이면 true. 실패는 로그만 남기고 false — topic/token 은 로그에 넣지 않는다.
export async function send(cfg: Pick<Config, "ntfyServer" | "ntfyToken">, msg: NtfyMessage): Promise<boolean> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // 익명 요청은 IP 기준 rate limit 인데 Workers 는 IP 를 공유해서 429 가 난다 → 토큰으로 계정 기준
  if (cfg.ntfyToken) headers.Authorization = `Bearer ${cfg.ntfyToken}`;
  try {
    const res = await fetch(`${cfg.ntfyServer}/`, {
      method: "POST",
      headers,
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return true;
    const body = (await res.text().catch(() => "")).slice(0, 200);
    console.error(`ntfy: HTTP ${res.status} for "${msg.title}": ${body}`);
  } catch (e) {
    console.error(`ntfy: request failed for "${msg.title}":`, e instanceof Error ? e.name : e);
  }
  return false;
}
