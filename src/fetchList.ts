export const USER_AGENT = "woko-watch/1.0 (personal notifier)";

export type FetchResult = { ok: true; html: string } | { ok: false; reason: string };

export async function fetchList(url: string): Promise<FetchResult> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, reason: `목록 응답 HTTP ${res.status}` };
    return { ok: true, html: await res.text() };
  } catch (e) {
    return { ok: false, reason: `목록 요청 실패: ${e instanceof Error ? `${e.name} ${e.message}` : String(e)}`.slice(0, 200) };
  }
}
