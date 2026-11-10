type Options = { difference?: boolean; spaced?: boolean };
type MoneyUnit = '원' | '만 원' | '억 원';
const moneyUnits: Record<MoneyUnit, number> = {
  원: 1,
  '만 원': 10000,
  '억 원': 100000000,
};
const numeric = (value: number, min = 0, max = 2) =>
  value.toLocaleString('ko-KR', {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  });
const join = (value: string, unit: string, spaced = false) => `${value}${spaced ? ' ' : ''}${unit}`;
/** 표시용 숫자 해석. 빈 문자열·잘못된 쉼표·파싱 실패는 0으로 바꾸지 않는다. */
export function displayNumber(raw: string): number | null {
  const text = raw.trim();
  if (text.includes(',') && !/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)) return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.replaceAll(',', ''))) return null;
  const value = Number(text.replaceAll(',', ''));
  return Number.isFinite(value) ? value : null;
}
function tiny(value: number, threshold: string, options: Options) {
  return `${value < 0 ? '음수의 ' : ''}미세한 ${options.difference ? '차이' : '값'} (${threshold} 미만)`;
}
/** 원은 정수, 만·억 원은 최대 두 자리로 표시한다. 실제 반올림한 환산 단위 금액은 두 자리를 남긴다. */
export function formatMoney(value: number, unit: MoneyUnit, options: Options = {}) {
  if (!Number.isFinite(value)) return '—';
  const max = unit === '원' ? 0 : 2;
  if (value !== 0 && Math.abs(value) < (unit === '원' ? 0.5 : 0.005)) {
    const won = value * moneyUnits[unit];
    if (unit !== '원' && Math.abs(won) >= 0.5) return formatMoney(won, '원', options);
    return tiny(value, join('1', '원', options.spaced), options);
  }
  const rounded = Number(value.toFixed(max));
  const changed = Math.abs(value - rounded) > Math.max(1, Math.abs(value)) * Number.EPSILON * 4;
  return join(numeric(value === 0 ? 0 : value, unit !== '원' && changed ? 2 : 0, max), unit, options.spaced);
}
/** 금리는 최대 두 자리, %p는 최소 한 자리. 작은 비영 차이는 최대 여섯 자리 또는 미세한 차이로 보존한다. */
export function formatRate(value: number, unit: '%' | '%p', options: Options = {}) {
  if (!Number.isFinite(value)) return '—';
  if (value !== 0 && Math.abs(value) < 0.005) {
    if (Math.abs(value) < 0.000001) return tiny(value, join('0.000001', unit, options.spaced), options);
    return join(numeric(value, 0, 6), unit, options.spaced);
  }
  return join(numeric(Object.is(value, -0) ? 0 : value, unit === '%p' ? 1 : 0, 2), unit, options.spaced);
}
/** 단위별 공통 표시 정책. 표시값을 계산 입력으로 반환하지 않는다. */
export function formatFinancial(value: number | null, unit: string, options: Options = {}) {
  if (value === null || !Number.isFinite(value)) return '—';
  if (Object.hasOwn(moneyUnits, unit)) return formatMoney(value, unit as MoneyUnit, options);
  if (unit === '%' || unit === '%p') return formatRate(value, unit, options);
  if (value !== 0 && Math.abs(value) < 0.005) return tiny(value, join('0.01', unit, options.spaced), options);
  return join(numeric(Object.is(value, -0) ? 0 : value), unit, options.spaced).trim();
}
