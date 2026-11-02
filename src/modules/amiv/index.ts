import { fetchText } from "../../observers/fetchText";
import { toPriority } from "../../observers/notify";
import type { Module } from "../../observers/observer";

// 사이트(amiv.ethz.ch/en/events)는 이 공개 API를 그린다. 근거는 docs/markup-notes.md
const SITE = "https://amiv.ethz.ch/en/events";
const API = "https://api.amiv.ethz.ch/events";
const FIELDS = ["title_en", "title_de", "catchphrase_en", "time_start", "location", "price", "time_register_start"];

export interface AmivEvent {
  _id: string;
  title_en?: string | null;
  title_de?: string | null;
  catchphrase_en?: string | null;
  time_start?: string | null;
  location?: string | null;
  price?: number | null; // Rappen
  time_register_start?: string | null;
}

// 사이트의 "다가오는 이벤트"와 같은 집합: show_website 이고 지금 광고 기간 안
export function apiUrl(now: Date): string {
  const t = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const where = { show_website: true, time_advertising_start: { $lte: t }, time_advertising_end: { $gte: t } };
  const projection = Object.fromEntries(FIELDS.map((f) => [f, 1]));
  // max_results 는 서버가 50으로 자른다
  return `${API}?where=${encodeURIComponent(JSON.stringify(where))}&projection=${encodeURIComponent(JSON.stringify(projection))}&sort=time_start&max_results=50`;
}

const fmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Europe/Zurich", year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const when = (iso: string | null | undefined) => (iso ? fmt.format(new Date(iso)) : undefined);

const amiv: Module<AmivEvent> = {
  name: "AMIV",
  stateKey: "state:amiv",
  create(cfg) {
    const priority = toPriority(cfg.priority);
    return {
      listUrl: SITE,
      async fetch(now) {
        const res = await fetchText(apiUrl(now), "application/json");
        if (!res.ok) return res;
        let body: { _items?: unknown; _meta?: { total?: number } };
        try {
          body = JSON.parse(res.text);
        } catch {
          return { ok: false, reason: "API 응답이 JSON 이 아님" };
        }
        if (!Array.isArray(body._items)) return { ok: false, reason: "API 응답에 _items 없음 (API 변경 의심)" };
        const items = (body._items as AmivEvent[]).filter((e) => typeof e._id === "string");
        if ((body._meta?.total ?? 0) > items.length) console.warn(`AMIV: ${body._meta?.total}건 중 ${items.length}건만 받음`);
        return { ok: true, items };
      },
      id: (e) => e._id,
      message(e) {
        const start = when(e.time_start);
        const reg = when(e.time_register_start);
        return {
          title: "🎉 AMIV 새 이벤트",
          message: [
            e.title_en?.trim() || e.title_de?.trim() || "(제목 없음)",
            e.catchphrase_en?.trim(),
            start && `📅 ${start}`,
            e.location && `📍 ${e.location}`,
            e.price ? `💰 ${e.price / 100} CHF` : undefined,
            reg && `📝 신청 시작 ${reg}`,
          ].filter(Boolean).join("\n"),
          priority,
          tags: ["amiv"],
          click: `${SITE}/${e._id}`,
        };
      },
    };
  },
};

export default amiv;
