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

export interface State {
  version: 1;
  seen: Record<string, string>; // oid -> 처음 본 ISO 시각
  // 지시서에 없는 필드: 목록에서 사라진 oid -> 처음 사라진 ISO 시각. 30일 prune 기준.
  missingSince: Record<string, string>;
  lastOkAt?: string;
  consecutiveFailures: number;
  lastHealthAlertAt?: string;
}

export interface Config {
  targetFrom: string;
  targetTo: string;
  ntfyServer: string;
  ntfyTopic: string;
  ntfyToken?: string; // ntfy.sh 액세스 토큰. 있으면 IP 대신 계정 기준 rate limit
  listUrl: string;
}
