/** 억·만 복합 통화를 하나의 토큰으로 읽고 원문 범위는 유지한다. */
export const amountPattern =
  /[+-]?\d[\d,]*(?:\.\d+)?\s*억\s*(?:\d[\d,]*(?:\.\d+)?\s*만\s*원|원)|[+-]?\d[\d,]*(?:\.\d+)?\s*(?:만\s*원|원|%|개월)/g;
/** 복합 통화만 원 단위 숫자로 바꾼다. 모호하거나 잘못된 쉼표·하위 단위는 거절한다. */
export function compoundAmount(text: string): number | null {
  const m = text.trim().match(/^([+-]?\d[\d,]*(?:\.\d+)?)\s*억\s*(\d[\d,]*(?:\.\d+)?)\s*만\s*원$/);
  if (!m) return null;
  const valid = (s: string) => !s.includes(',') || /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s);
  if (!m.slice(1).every(valid)) return null;
  const upper = Number(m[1].replaceAll(',', '')),
    lower = Number(m[2].replaceAll(',', ''));
  if (lower >= 10000 || !Number.isInteger(upper)) return null;
  const n = upper * 100000000 + (m[1].startsWith('-') ? -1 : 1) * lower * 10000;
  return Number.isSafeInteger(n) ? n : null;
}
