import { fetchText } from "../../observers/fetchText";
import { cleanText, decodeEntities } from "../../observers/html";
import { toPriority } from "../../observers/notify";
import type { Module } from "../../observers/observer";

// 사이트(vis.ethz.ch/en/events)의 다가오는 이벤트와 같은 목록을 RSS 로 준다
const SITE = "https://vis.ethz.ch/en/events/";
const RSS = "https://vis.ethz.ch/en/events/rss.xml";

export interface VisEvent {
  link: string; // guid 와 같다. 고유 키
  title: string;
  when?: string; // "Nov 3, 2026, 18:15–21:15" 원문
  where?: string;
}

export function parseRss(xml: string): VisEvent[] {
  const out: VisEvent[] = [];
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(item!)?.[1] ?? "";
    const link = cleanText(tag("link"));
    const title = cleanText(tag("title"));
    if (!link || !title) {
      console.warn("VIS: skipped item without link/title:", cleanText(item!).slice(0, 120));
      continue;
    }
    // description 은 이스케이프된 HTML: "<p><strong>When: …</strong></p><p>Where: …</p>"
    const desc = decodeEntities(tag("description"));
    const field = (k: string) => cleanText(new RegExp(`${k}:([^<]*)`).exec(desc)?.[1] ?? "") || undefined;
    out.push({ link, title, when: field("When"), where: field("Where") });
  }
  return out;
}

const vis: Module<VisEvent> = {
  name: "VIS",
  stateKey: "state:vis",
  create(cfg) {
    const priority = toPriority(cfg.priority);
    return {
      listUrl: SITE,
      async fetch() {
        const res = await fetchText(RSS, "application/rss+xml");
        if (!res.ok) return res;
        // 이벤트 0건은 정상일 수 있다(방학). RSS 자체가 아니면 실패
        if (!/<channel[\s>]/.test(res.text)) return { ok: false, reason: "RSS 형식 아님 (피드 변경 의심)" };
        return { ok: true, items: parseRss(res.text) };
      },
      id: (e) => e.link,
      message: (e) => ({
        title: "🎉 VIS 새 이벤트",
        message: [e.title, e.when && `📅 ${e.when}`, e.where && `📍 ${e.where}`].filter(Boolean).join("\n"),
        priority,
        tags: ["vis"],
        click: e.link,
      }),
    };
  },
};

export default vis;
