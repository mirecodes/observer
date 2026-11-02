import { fetchText } from "../../observers/fetchText";
import type { Module } from "../../observers/observer";
import { classifyTiming, isNotifiable } from "./classify";
import { isIsoDate } from "./dates";
import { listingMessage, summaryMessage, type Item } from "./messages";
import { parseListings } from "./parse";

export const LIST_URL = "https://www.woko.ch/unser-angebot/freie-objekte";

const woko: Module<Item> = {
  name: "WOKO",
  stateKey: "state:v1", // 모듈화 전부터 쓰던 키. 바꾸면 첫 실행으로 돌아간다
  create(cfg) {
    const from = String(cfg.targetFrom ?? "");
    const to = String(cfg.targetTo ?? "");
    if (!isIsoDate(from)) throw new Error("cfg: targetFrom must be yyyy-mm-dd");
    if (!isIsoDate(to)) throw new Error("cfg: targetTo must be yyyy-mm-dd");
    if (from > to) throw new Error("cfg: targetFrom must be <= targetTo");
    return {
      listUrl: LIST_URL,
      async fetch() {
        const res = await fetchText(LIST_URL);
        if (!res.ok) return res;
        const listings = parseListings(res.text, LIST_URL);
        if (listings.length === 0) return { ok: false, reason: "파싱 결과 0건 (사이트 마크업 변경 의심)" };
        return { ok: true, items: listings.map((l) => ({ listing: l, timing: classifyTiming(l, from, to) })) };
      },
      id: (i) => String(i.listing.oid),
      notifiable: (i) => isNotifiable(i.listing.category),
      message: listingMessage,
      summary: (items) => summaryMessage(items, LIST_URL),
    };
  },
};

export default woko;
