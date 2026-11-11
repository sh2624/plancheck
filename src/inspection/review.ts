import type { Candidate } from '../normalization/types';
import { normalize, canConfirm, editCandidate } from '../normalization/values';
import { applyRecommendation, type ReviewState } from '../recommendations/apply';
import type { Recommendation } from '../recommendations/types';
import { loanIdentity } from '../recommendations/recommend';
import { assessRelationship } from '../normalization/relationships';
import type { Finding } from './analyze';
export type ReviewChoice = 'same' | 'different' | 'unknown';
export type InlineAnswers = {
  asOf?: string;
  scenario?: string;
  period?: string;
  certaintyConfirmed?: boolean;
  units?: Record<string, Candidate['unit']>;
};
export type ReviewDecision = {
  choice: ReviewChoice;
  candidateIds: string[];
  fingerprint: string;
};
const compact = (s: string) => s.replace(/\s+/g, '');
const monthly = (s: string) => (['월', '월간', '매월'].includes(compact(s)) ? '월간' : compact(s));
const flow = (c: Candidate) => ['income', 'fixedExpense', 'variableExpense', 'savings', 'surplus', 'loanPayment'].includes(c.field);
/** 현재 원본 쌍의 유효한 사용자 승인만 재사용하며 추천이나 다른 위치의 값을 승인으로 간주하지 않는다. */
export function previouslyApprovedPair(finding: Finding, items: Candidate[]) {
  const ids = finding.recommendation?.candidateIds ?? [];
  return (
    !!finding.approved &&
    ids.length === 2 &&
    ids.every((id) => items.some((c) => c.id === id && c.confirmed && !c.excluded)) &&
    reviewFingerprint(items, ids) === reviewFingerprint(finding.approved.evidence, ids)
  );
}
/** 현재 원본·수치·조건에 한정한 결정이며 편집 후 오래된 결정을 사용하지 않는다. */
export function reviewFingerprint(items: Candidate[], ids: string[]) {
  return JSON.stringify(
    ids.map((id) => {
      const c = items.find((c) => c.id === id);
      return c
        ? [
            c.id,
            c.source,
            c.fileName,
            c.location,
            c.label,
            c.originalText,
            c.originalNumber,
            c.number,
            c.unit,
            c.normalizedValue,
            c.field,
            c.asOf,
            c.period,
            c.scenario,
            c.certainty,
            c.excluded,
          ]
        : null;
    }),
  );
}
/** 실제 누락·불일치한 조건만 추가 질문으로 요청한다. */
export function inlineRequirements(items: Candidate[]) {
  return {
    asOf: items.some((c) => !c.asOf.trim()) || new Set(items.map((c) => compact(c.asOf))).size > 1,
    scenario: items.some((c) => !c.scenario.trim()) || new Set(items.map((c) => compact(c.scenario))).size > 1,
    period: (items.some(flow) && items.some((c) => !c.period.trim())) || new Set(items.map((c) => monthly(c.period))).size > 1,
    certainty: items.some((c) => c.certainty !== '확정'),
    units: items.filter((c) => !canConfirm(c) || normalize(c.number, c.unit) !== c.normalizedValue).map((c) => c.id),
  };
}
type Outcome =
  | {
      ok: true;
      state: ReviewState;
      decision: ReviewDecision;
      changedIds: string[];
    }
  | { ok: false; issues: string[] };
/** 명시적 인라인 답변을 기존 편집·승인 경로에 전달한다. 반대·미확인은 해당 연결 승인만 해제한다. */
export function applyInlineReview(state: ReviewState, r: Recommendation, choice: ReviewChoice, answers: InlineAnswers = {}): Outcome {
  if (!r.link || r.candidateIds.length !== 2 || ![r.link.xlsxId, r.link.docxId].every((id) => r.candidateIds.includes(id)))
    return { ok: false, issues: ['이 관계는 상세 검토에서 확인하세요.'] };
  const ids = [r.link.xlsxId, r.link.docxId],
    members = ids.map((id) => state.items.find((c) => c.id === id));
  if (members.some((c) => !c || c.excluded))
    return {
      ok: false,
      issues: ['원본 항목이 없거나 제외됐습니다. 다시 검사하세요.'],
    };
  const pair = members as Candidate[];
  if (choice !== 'same')
    return {
      ok: true,
      state: {
        ...state,
        links: state.links.filter((l) => l.xlsxId !== r.link!.xlsxId || l.docxId !== r.link!.docxId),
      },
      decision: {
        choice,
        candidateIds: ids,
        fingerprint: reviewFingerprint(state.items, ids),
      },
      changedIds: [],
    };
  if (
    pair[0].source !== 'XLSX' ||
    pair[1].source !== 'DOCX' ||
    pair[0].field !== pair[1].field ||
    assessRelationship(pair[0], pair[1]).blocked ||
    pair.some((c) => c.field.startsWith('loan') && (!loanIdentity(c) || loanIdentity(c) !== loanIdentity(pair[0])))
  )
    return {
      ok: false,
      issues: ['대상 유형·대출 명칭이 다르거나 불명확합니다. 상세 검토에서 관계를 수정하세요.'],
    };
  const need = inlineRequirements(pair),
    issues: string[] = [];
  if (need.asOf && !answers.asOf?.trim()) issues.push('원문을 대조해 공통 기준일을 입력하세요.');
  if (need.scenario && !answers.scenario?.trim()) issues.push('원문을 대조해 공통 시나리오를 입력하세요.');
  if (need.period && !answers.period?.trim()) issues.push('공통 적용 기간을 입력하세요.');
  if (issues.length) return { ok: false, issues };
  const changedIds: string[] = [];
  const items = state.items.map((c) => {
    if (!ids.includes(c.id)) return c;
    const patch: Partial<Candidate> = {
      ...(need.asOf ? { asOf: answers.asOf!.trim() } : {}),
      ...(need.scenario ? { scenario: answers.scenario!.trim() } : {}),
      ...(need.period ? { period: answers.period!.trim() } : {}),
      ...(answers.certaintyConfirmed ? { certainty: '확정' as const } : {}),
      ...(answers.units?.[c.id] ? { unit: answers.units[c.id] } : {}),
    };
    if (Object.entries(patch).some(([key, value]) => c[key as keyof Candidate] !== value)) {
      changedIds.push(c.id);
      return editCandidate(c, patch);
    }
    return c;
  });
  if (
    ids.some((id) => {
      const c = items.find((c) => c.id === id)!;
      return !canConfirm(c) || normalize(c.number, c.unit) !== c.normalizedValue;
    })
  )
    return {
      ok: false,
      issues: ['수치·단위가 유효하지 않습니다. 단위를 확인하거나 상세 검토에서 원본 숫자를 수정하세요.'],
    };
  const next = applyRecommendation(
    {
      ...state,
      items,
      links: state.links.filter((l) => !changedIds.includes(l.xlsxId) && !changedIds.includes(l.docxId)),
      calculations: state.calculations.map((c) =>
        changedIds.includes(c.targetId) ||
        Object.values(c.groups)
          .flat()
          .some((id) => changedIds.includes(id))
          ? { ...c, scopeConfirmed: false }
          : c,
      ),
    },
    r,
    true,
  );
  return {
    ok: true,
    state: next,
    changedIds,
    decision: {
      choice,
      candidateIds: ids,
      fingerprint: reviewFingerprint(next.items, ids),
    },
  };
}
/** 기존 편집·연결·파일 교체에서 해당 결정만 무효화한다. */
export function removeDecisions(records: Record<string, ReviewDecision>, ids: string[]) {
  return Object.fromEntries(Object.entries(records).filter(([, r]) => !r.candidateIds.some((id) => ids.includes(id))));
}
