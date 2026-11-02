export const USER_AGENT = "observer/1.0 (personal notifier)";

export type FetchResult = { ok: true; text: string } | { ok: false; reason: string };

export async function fetchText(url: string, accept = "text/html"): Promise<FetchResult> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: accept },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, reason: `응답 HTTP ${res.status}` };
    return { ok: true, text: await res.text() };
  } catch (e) {
    return { ok: false, reason: `요청 실패: ${e instanceof Error ? `${e.name} ${e.message}` : String(e)}`.slice(0, 200) };
  }
}
