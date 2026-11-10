import type { Candidate } from '../normalization/types';
import type { Recommendation } from '../recommendations/types';
import { coreFields } from '../recommendations/types';
import { displayNumber, formatFinancial } from './format';
/** 금리의 부동소수점 표시 잡음만 정리하고 원본 문자열과 편집 값은 그대로 둔다. */
export function candidateValue(c: Candidate) {
  const value = displayNumber(c.number);
  return value === null ? `값 미확인 ${c.unit}` : formatFinancial(value, c.unit);
}
/** 핵심 추천에 필요한 후보를 우선하고 실제 수동 입력 항목도 확인 대상에 남긴다. */
export function coreCandidates(items: Candidate[], recommendations: Recommendation[]) {
  const ids = new Set(recommendations.filter((r) => r.primary).flatMap((r) => r.candidateIds));
  return items.filter((c) => !c.excluded && (ids.has(c.id) || coreFields.includes(c.field) || c.method === '직접 입력')).map((c) => c.id);
}
/** 확인은 숫자 정확성이나 검증 완료를 뜻하지 않으므로 진행률을 따로 집계한다. */
export function reviewProgress(items: Candidate[], ids: string[]) {
  const selected = items.filter((c) => ids.includes(c.id) && !c.excluded);
  return {
    total: selected.length,
    confirmed: selected.filter((c) => c.confirmed).length,
    pending: selected.filter((c) => !c.confirmed).map((c) => c.id),
  };
}
