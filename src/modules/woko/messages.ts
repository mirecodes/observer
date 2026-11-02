import type { Message } from "../../observers/notify";
import type { Listing, Timing } from "./types";

export interface Item {
  listing: Listing;
  timing: Timing;
}

const SUMMARY_MAX_LINES = 20;

const isUrgent = (t: Timing) => t === "target" || t === "unknown";

function rentText(l: Listing): string | undefined {
  return l.rentChf === undefined ? undefined : `${l.rentChf} CHF/월`;
}

export function listingMessage({ listing: l, timing }: Item): Message {
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
  const actions: NonNullable<Message["actions"]> = [{ action: "view", label: "상세", url: l.detailUrl }];
  if (l.applyUrl) actions.push({ action: "view", label: "지원하기", url: l.applyUrl });
  return {
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

export function summaryMessage(items: Item[], listUrl: string): Message {
  const urgent = items.some((i) => isUrgent(i.timing));
  const lines = items.slice(0, SUMMARY_MAX_LINES).map(({ listing: l, timing }) =>
    [`${isUrgent(timing) ? "⭐" : "•"} ${l.title}`, l.place, rentText(l), l.availableRaw].filter(Boolean).join(" — "),
  );
  if (items.length > SUMMARY_MAX_LINES) lines.push(`… 외 ${items.length - SUMMARY_MAX_LINES}건`);
  return {
    title: urgent ? `⭐ WOKO 새 매물 ${items.length}건` : `🏠 WOKO 새 매물 ${items.length}건 (참고용)`,
    message: lines.join("\n"),
    priority: urgent ? 5 : 3,
    tags: ["woko"],
    click: listUrl,
    actions: [{ action: "view", label: "목록 열기", url: listUrl }],
  };
}
