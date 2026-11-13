import type { Candidate } from '../normalization/types';
import { formatFinancial } from './format';
import type { ReviewedFinding } from './findingGroups';
/** 응답 기록과 명시된 비교 조건을 구분하며 최종 승인 여부를 생성하지 않는다. */
export function comparisonReviewStatus(f: ReviewedFinding) {
  const p = f.result.evidence;
  const label = f.signal === '수치 차이' ? '수치 차이 확인' : '수치 검토 완료';
  if (f.relationship?.dateConflict || f.relationship?.scenarioConflict || f.relationship?.periodConflict) return `${label} · 기준 불일치`;
  return p.length === 2 &&
    p.every((c) => c.asOf.trim() && c.scenario.trim()) &&
    new Set(p.map((c) => c.asOf.trim())).size === 1 &&
    new Set(p.map((c) => c.scenario.trim())).size === 1
    ? `${label} · 최종 판정 전`
    : `${label} · 비교 조건 미확인`;
}
/** 표시 단위만 통일하며 원 단위 차이를 다시 계산하지 않는다. 작은 비정수 만 원 차이는 원으로 유지한다. */
export function comparisonFormat(evidence: Candidate[], unit: string) {
  const money = unit === '원' && evidence.every((c) => ['원', '만 원', '억 원'].includes(c.unit));
  const display =
    money && evidence.some((c) => c.unit === '만 원')
      ? '만 원'
      : money && evidence.length > 0 && evidence.every((c) => c.unit === '억 원')
        ? '억 원'
        : unit;
  const scale = display === '만 원' ? 10000 : display === '억 원' ? 100000000 : 1;
  return {
    value: (value: number | null) => formatFinancial(value === null ? null : value / scale, display),
    difference: (value: number) => {
      const amount = Math.abs(value);
      if (money && display !== '원' && (!Number.isInteger(amount / scale) || amount < scale))
        return formatFinancial(amount, '원', { difference: true });
      return formatFinancial(amount / scale, unit === '%' ? '%p' : display, { difference: true });
    },
  };
}
