import { cleanText, decodeEntities } from "../../observers/html";
import { classifyCategory } from "./classify";
import { parseAvailableFrom } from "./dates";
import type { Listing } from "./types";

// 마크업 근거는 docs/markup-notes.md. 정규식 범위는 매물 블록 하나로 좁힌다.

function absUrl(href: string, base: string): string | undefined {
  try {
    return new URL(decodeEntities(href.trim()), base).href;
  } catch {
    return undefined;
  }
}

// "580.-", "1'250.-", "1’250.50" -> 숫자
export function parseRent(raw: string): number | undefined {
  const m = /(\d[\d'’]*)(?:\.(\d{1,2}))?/.exec(raw);
  if (!m) return undefined;
  const n = Number(`${m[1]!.replace(/['’]/g, "")}.${m[2] ?? "0"}`);
  return Number.isFinite(n) ? n : undefined;
}

// 매물 블록 단위로 자른다. 다음 블록 시작이나 페이징 영역 전까지.
function splitBlocks(html: string): string[] {
  const starts = [...html.matchAll(/<div class="crooms__element[\s"]/g)].map((m) => m.index);
  const pagingIdx = html.indexOf('class="crooms__paging"');
  const end = pagingIdx === -1 ? html.length : pagingIdx;
  return starts.map((s, i) => html.slice(s, Math.min(starts[i + 1] ?? end, end)));
}

function parseBlock(block: string, baseUrl: string): Listing | undefined {
  const pick = (re: RegExp) => {
    const m = re.exec(block);
    return m?.[1] === undefined ? undefined : cleanText(m[1]) || undefined;
  };

  const detailHref = /<a\s[^>]*href="([^"]*detail\?oid=\d+[^"]*)"/.exec(block)?.[1];
  const oid = Number(/[?&]oid=(\d+)/.exec(detailHref ?? "")?.[1]);
  const detailUrl = detailHref && absUrl(detailHref, baseUrl);
  const title = pick(/<h3[^>]*crooms__headline[^>]*>([\s\S]*?)<\/h3>/);
  if (!Number.isSafeInteger(oid) || oid <= 0 || !detailUrl || !title) return undefined;

  // "Wann" / "Adresse" / "Ort" 키-값 쌍
  const fields: Record<string, string> = {};
  for (const m of block.matchAll(
    /crooms__text--key[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*class="crooms__text"[^>]*>([\s\S]*?)<\/div>/g,
  )) {
    fields[cleanText(m[1]!)] = cleanText(m[2]!);
  }

  const badge = pick(/<\/h3>\s*<strong[^>]*>([\s\S]*?)<\/strong>/);
  const applyHref = /<a\s[^>]*href="([^"]*)"[^>]*title="Bewerben"/.exec(block)?.[1];
  const rentRaw = pick(/crooms__price--value[^>]*>([\s\S]*?)<\/span>/);
  const availableRaw = fields["Wann"] ?? "";
  const typ = /\sdata-typ="([^"]*)"/.exec(block)?.[1];

  return {
    oid,
    title,
    badge,
    availableFrom: parseAvailableFrom(availableRaw),
    availableRaw,
    address: fields["Adresse"] || undefined,
    place: fields["Ort"] || undefined,
    rentChf: rentRaw === undefined ? undefined : parseRent(rentRaw),
    detailUrl,
    applyUrl: applyHref ? absUrl(applyHref, baseUrl) : undefined,
    category: classifyCategory(typ, title, badge),
  };
}

export function parseListings(html: string, baseUrl: string): Listing[] {
  const out: Listing[] = [];
  for (const block of splitBlocks(html)) {
    if (/^<div class="crooms__element[^"]*\bno-data\b/.test(block)) continue; // "kein Eintrag gefunden" 자리표시
    const l = parseBlock(block, baseUrl);
    if (l) {
      if (!out.some((o) => o.oid === l.oid)) out.push(l);
    } else console.warn("parse: skipped block without oid/detailUrl/title:", cleanText(block).slice(0, 120));
  }
  return out;
}
