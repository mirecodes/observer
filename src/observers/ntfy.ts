import { post, type Secrets, type Send } from "./notify";

// docs.ntfy.sh/publish "Publish as JSON". 메시지에 NTFY_TOPIC 값은 넣지 않는다.
export function ntfy(env: Secrets, server: string): Send {
  const topic = env.NTFY_TOPIC ?? "";
  if (!/^[-_A-Za-z0-9]{1,64}$/.test(topic)) {
    throw new Error("config: NTFY_TOPIC missing or invalid (letters, digits, - and _, max 64). Set it with `wrangler secret put NTFY_TOPIC`");
  }
  const token = env.NTFY_TOKEN?.trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // 익명 요청은 IP 기준 rate limit 인데 Workers 는 IP 를 공유해서 429 가 난다 → 토큰으로 계정 기준
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `${server.replace(/\/$/, "")}/`;
  return (msg) => post("ntfy", url, { headers, body: JSON.stringify({ topic, ...msg }) }, msg.title);
}
