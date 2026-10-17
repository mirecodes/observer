import { isIsoDate } from "./dates";
import type { Config } from "./types";

type RawEnv = Record<"TARGET_FROM" | "TARGET_TO" | "NTFY_SERVER" | "NTFY_TOPIC" | "LIST_URL", string | undefined> & {
  NTFY_TOKEN?: string;
};

function httpUrl(name: string, v: string | undefined): string {
  try {
    const u = new URL(v ?? "");
    if (u.protocol === "https:" || u.protocol === "http:") return u.href.replace(/\/$/, "");
  } catch {}
  throw new Error(`config: ${name} must be an http(s) URL`);
}

// 잘못된 값이면 throw. 메시지에 NTFY_TOPIC 값은 넣지 않는다.
export function loadConfig(env: RawEnv): Config {
  const targetFrom = env.TARGET_FROM ?? "";
  const targetTo = env.TARGET_TO ?? "";
  if (!isIsoDate(targetFrom)) throw new Error("config: TARGET_FROM must be yyyy-mm-dd");
  if (!isIsoDate(targetTo)) throw new Error("config: TARGET_TO must be yyyy-mm-dd");
  if (targetFrom > targetTo) throw new Error("config: TARGET_FROM must be <= TARGET_TO");
  const ntfyTopic = env.NTFY_TOPIC ?? "";
  if (!/^[-_A-Za-z0-9]{1,64}$/.test(ntfyTopic)) {
    throw new Error("config: NTFY_TOPIC missing or invalid (letters, digits, - and _, max 64). Set it with `wrangler secret put NTFY_TOPIC`");
  }
  return {
    targetFrom,
    targetTo,
    ntfyServer: httpUrl("NTFY_SERVER", env.NTFY_SERVER),
    ntfyTopic,
    ntfyToken: env.NTFY_TOKEN?.trim() || undefined,
    listUrl: httpUrl("LIST_URL", env.LIST_URL),
  };
}
