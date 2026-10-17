import { isImmediate } from "./dates";
import type { Category, Listing, Timing } from "./types";

// 사이트의 so_typ 필터 값 (docs/markup-notes.md)
const TYP: Record<string, Category> = { "0": "residential", "1": "parking", "2": "commercial" };

// 움라우트를 ae/oe/ue 로 펴서 비교. "velo"/"lager" 는 단어 시작만 (develop, Schlager 오탐 방지).
const PARKING = /parkplatz|tiefgarage|garage|toeff|motorrad|\bvelo/;
const COMMERCIAL = /gewerbe|buero|\blager|atelier/;

function fold(s: string): string {
  return s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue");
}

export function categoryFromKeywords(text: string): Category {
  const t = fold(text);
  if (PARKING.test(t)) return "parking";
  if (COMMERCIAL.test(t)) return "commercial";
  return "residential";
}

// data-typ 이 있으면 그것, 없으면 키워드. 알 수 없는 data-typ 값은 키워드로도 안 걸리면 unknown(=알림).
export function classifyCategory(typ: string | undefined, title: string, badge = ""): Category {
  if (typ !== undefined && TYP[typ]) return TYP[typ];
  const kw = categoryFromKeywords(`${title} ${badge}`);
  return typ !== undefined && kw === "residential" ? "unknown" : kw;
}

export function isNotifiable(category: Category): boolean {
  return category === "residential" || category === "unknown";
}

// yyyy-mm-dd 문자열 비교. 양 끝 포함.
export function classifyTiming(l: Pick<Listing, "availableFrom" | "availableRaw">, from: string, to: string): Timing {
  if (l.availableFrom === undefined) return isImmediate(l.availableRaw) ? "early" : "unknown";
  if (l.availableFrom < from) return "early";
  if (l.availableFrom > to) return "late";
  return "target";
}
