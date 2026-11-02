export type Category = "residential" | "parking" | "commercial" | "unknown";
export type Timing = "target" | "early" | "late" | "unknown";

export interface Listing {
  oid: number; // Detail 링크의 oid. 고유 키
  title: string;
  badge?: string; // "Untermieter gesucht" 등
  availableFrom?: string; // ISO yyyy-mm-dd. 파싱 실패 시 undefined
  availableRaw: string; // "Ab 03.11.2026" 원문
  address?: string;
  place?: string; // "8600 Dübendorf"
  rentChf?: number; // "580.-" -> 580
  detailUrl: string; // 절대 URL
  applyUrl?: string; // Bewerben 링크(있을 때만), 절대 URL
  category: Category;
}
