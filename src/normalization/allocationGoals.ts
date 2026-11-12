import type { Candidate } from './types';
import type { EvidenceRef } from '../validation/types';
import { allocationText } from '../planning/allocationText';
import { normalize } from './values';
/** 명시적 배정 문장의 목표와 배정액만 후보화한다. 목표 전체 예산·확정 여부는 추론하지 않는다. */
export function allocationGoals(refs: EvidenceRef[]): Candidate[] {
  return refs.flatMap((ref) =>
    allocationText(ref).map((a) => ({
      id: `${ref.source}:${ref.location}:배정목표:${a.index}`,
      source: ref.source,
      fileName: ref.fileName,
      location: `${ref.location} · 배정목표 ${a.index + 1}`,
      originalText: ref.originalText,
      originalNumber: a.amount,
      label: a.goal,
      number: a.amount,
      unit: a.unit,
      normalizedValue: normalize(a.amount, a.unit),
      field: 'goalAmount' as const,
      asOf: '',
      period: a.context.timing,
      scenario: a.context.scenario,
      certainty: '미확인' as const,
      confirmed: false,
      excluded: false,
      method: '문단 근접 문맥' as const,
      confidence: '확인 필요' as const,
      note: '명시된 목표 배정액입니다. 목표 전체 예산 및 사용 조건은 확인이 필요합니다.',
    })),
  );
}
