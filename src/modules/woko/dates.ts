// "dd.mm.yyyy" -> "yyyy-mm-dd". 존재하지 않는 날짜(31.02.2027)는 undefined.
export function toIso(dd: string, mm: string, yyyy: string): string | undefined {
  const iso = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : undefined;
}

// 실제 달력에 있는 yyyy-mm-dd 인지. UTC 로만 계산한다.
export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

// "Ab 03.11.2026", "01.12.2026 - 31.01.2027" 등에서 첫 날짜(시작일)를 ISO 로.
// "Ab sofort" 나 파싱 실패는 undefined (sofort 판별은 isImmediate).
export function parseAvailableFrom(raw: string): string | undefined {
  const m = /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/.exec(raw);
  return m ? toIso(m[1]!, m[2]!, m[3]!) : undefined;
}

export function isImmediate(raw: string): boolean {
  return /\bsofort\b/i.test(raw);
}
