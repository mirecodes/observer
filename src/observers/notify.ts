import type { Config } from "./config";
import { ntfy } from "./ntfy";
import { pushover } from "./pushover";

export type Priority = 1 | 2 | 3 | 4 | 5; // ntfy 기준. 1 최저, 5 최고

// 채널 공통 알림 형식. 각 채널이 자기 API 형식으로 바꿔 보낸다.
export interface Message {
  title: string;
  message: string;
  priority: Priority;
  tags?: string[];
  click?: string; // 알림을 누르면 열 URL
  actions?: { action: "view"; label: string; url: string }[];
}

// 성공(2xx)이면 true. 실패는 로그만 남기고 false
export type Send = (msg: Message) => Promise<boolean>;

// 비밀값은 `wrangler secret put` 으로만 넣는다
export interface Secrets {
  NTFY_TOPIC?: string;
  NTFY_TOKEN?: string;
  PUSHOVER_TOKEN?: string;
  PUSHOVER_USER?: string;
}

// cfgs/notifier.yml 의 provider 로 채널을 고른다. 비밀값이 없거나 잘못되면 throw
export function loadSender(env: Secrets, cfg: Config["notifier"]): Send {
  return cfg.provider === "pushover" ? pushover(env, cfg.pushover) : ntfy(env, cfg.ntfy.server);
}

export function toPriority(v: unknown): Priority {
  if (v === 1 || v === 2 || v === 3 || v === 4 || v === 5) return v;
  throw new Error("cfg: priority must be 1..5");
}

// 채널 공통 POST. 비밀값은 로그에 넣지 않는다.
export async function post(channel: string, url: string, init: RequestInit, title: string): Promise<boolean> {
  try {
    const res = await fetch(url, { ...init, method: "POST", signal: AbortSignal.timeout(10_000) });
    if (res.ok) return true;
    const body = (await res.text().catch(() => "")).slice(0, 200);
    console.error(`${channel}: HTTP ${res.status} for "${title}": ${body}`);
  } catch (e) {
    console.error(`${channel}: request failed for "${title}":`, e instanceof Error ? e.name : e);
  }
  return false;
}
