export type GroundingIssue = {
  path: string;
  code: string;
  category: 'structure' | 'source' | 'target' | 'amount' | 'action' | 'timing';
  relatedFields?: string[];
};
/** 원문 값 없이 실패 위치와 고정 코드만 전달한다. */
export class GroundingError extends Error {
  readonly issue: GroundingIssue;
  constructor(issue: GroundingIssue) {
    super(issue.code);
    this.name = 'GroundingError';
    this.issue = issue;
  }
}
/** 개인정보를 오류 메시지에 넣지 않는다. */
export function reject(path: string, code: string, category: GroundingIssue['category'], relatedFields?: string[]): never {
  throw new GroundingError({ path, code, category, ...(relatedFields ? { relatedFields } : {}) });
}
const compact = (text: string) => text.replace(/\s/gu, '');
/** 공백 차이만 허용하고 실제 원문의 연속 구간을 돌려준다. 동의어·문장 재작성은 허용하지 않는다. */
export function originalSpan(source: string, literal: string): string | null {
  const wanted = compact(literal);
  if (!wanted) return null;
  const positions: number[] = [];
  let folded = '';
  for (let i = 0; i < source.length; i++)
    if (!/\s/u.test(source[i])) {
      positions.push(i);
      folded += source[i];
    }
  const index = folded.indexOf(wanted);
  if (index < 0) return null;
  if (/^\d/.test(wanted) && index > 0 && /[\d,.]/.test(folded[index - 1])) return null;
  if (/\d$/.test(wanted) && /[\d,.]/.test(folded[index + wanted.length] ?? '')) return null;
  return source.slice(positions[index], positions[index + wanted.length - 1] + 1);
}
/** 금액·단위·행동만으로 구성된 표현은 금융 대상명이 아니다. */
export function entityTarget(text: string): boolean {
  const value = compact(text);
  return (
    !!value && !/^(?:원|만원|억원|%|개월|년|유지|중단|시작|증액|감액)$/.test(value) && !/^-?[\d,.]+(?:원|만원|억원|%|개월|년)?$/.test(value)
  );
}
const unitInfo: Record<string, { unit: string; dimension: string; multiplier: bigint }> = {
  원: { unit: '원', dimension: 'money', multiplier: 1n },
  만원: { unit: '만 원', dimension: 'money', multiplier: 10000n },
  억원: { unit: '억 원', dimension: 'money', multiplier: 100000000n },
  '%': { unit: '%', dimension: 'rate', multiplier: 1n },
  개월: { unit: '개월', dimension: 'duration', multiplier: 1n },
  년: { unit: '년', dimension: 'duration', multiplier: 12n },
};
const numeric = '-?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
function rational(number: string, multiplier: bigint) {
  const [whole, fraction = ''] = number.replaceAll(',', '').split('.');
  if (fraction.length > 12) return null;
  const negative = whole.startsWith('-');
  return {
    numerator: BigInt(`${whole.replace('-', '')}${fraction}`) * multiplier * (negative ? -1n : 1n),
    denominator: 10n ** BigInt(fraction.length),
  };
}
/** 숫자와 단위를 한 쌍으로 대조한다. 환산값이 정확히 같은 원문 토큰만 채택한다. */
export function originalAmount(number: string, unit: string, quote: string): { number: string; unit: string } | null {
  if (!new RegExp(`^${numeric}$`).test(number)) return null;
  const requestedUnit = unitInfo[compact(unit)];
  if (!requestedUnit) return null;
  const requested = rational(number, requestedUnit.multiplier);
  if (!requested) return null;
  const regex = new RegExp(`(?<![\\d,.])(${numeric})\\s*(억\\s*원|만\\s*원|원|%|개월|년)`, 'gu');
  for (const match of quote.matchAll(regex)) {
    const sourceUnit = unitInfo[compact(match[2])];
    if (!sourceUnit || requestedUnit.dimension !== sourceUnit.dimension) continue;
    const source = rational(match[1], sourceUnit.multiplier);
    if (source && source.numerator * requested.denominator === requested.numerator * source.denominator)
      return { number: match[1], unit: sourceUnit.unit };
  }
  return null;
}
