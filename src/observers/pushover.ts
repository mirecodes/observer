import { post, type Message, type Secrets, type Send } from "./notify";

// pushover.net/api
export const PUSHOVER_URL = "https://api.pushover.net/1/messages.json";

// ntfy 1..5 → pushover -2..1. 2(emergency)는 확인할 때까지 반복 울려서 쓰지 않는다
const PRIORITY = [-2, -1, 0, 1, 1] as const;

// pushover 는 링크 버튼이 하나뿐이라 click 을 버튼으로, 나머지 링크는 본문 끝에 붙인다(앱이 자동 링크)
export function toPushover(msg: Message): Record<string, string> {
  const extra = (msg.actions ?? []).filter((a) => a.url !== msg.click).map((a) => `${a.label}: ${a.url}`);
  const out: Record<string, string> = {
    title: msg.title.slice(0, 250),
    message: [msg.message, ...extra].join("\n").slice(0, 1024),
    priority: String(PRIORITY[msg.priority - 1]),
  };
  if (msg.click) {
    out.url = msg.click.slice(0, 512);
    out.url_title = (msg.actions?.find((a) => a.url === msg.click)?.label ?? "열기").slice(0, 100);
  }
  return out;
}

export function pushover(env: Secrets, cfg: { sound?: string } = {}): Send {
  const token = env.PUSHOVER_TOKEN?.trim() ?? "";
  const user = env.PUSHOVER_USER?.trim() ?? "";
  if (!/^\w{30}$/.test(token)) throw new Error("config: PUSHOVER_TOKEN missing or invalid. Set it with `wrangler secret put PUSHOVER_TOKEN`");
  if (!/^\w{30}$/.test(user)) throw new Error("config: PUSHOVER_USER missing or invalid. Set it with `wrangler secret put PUSHOVER_USER`");
  return (msg) => {
    const body = new URLSearchParams({ token, user, ...toPushover(msg) });
    if (cfg.sound) body.set("sound", cfg.sound);
    return post("pushover", PUSHOVER_URL, { body }, msg.title);
  };
}
