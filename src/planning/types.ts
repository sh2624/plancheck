import type { Candidate } from '../normalization/types';
import type { EvidenceRef } from '../validation/types';
export type RecordBase = {
  id: string;
  label: string;
  confirmed: boolean;
  excluded: boolean;
  references: EvidenceRef[];
  candidateIds: string[];
  note: string;
  origin: '자동 후보' | '직접 입력';
  /** 자동 발견의 원문 관계이며 사용자 승인을 뜻하지 않는다. */
  relation?: { kind: 'allocation' | 'reflection' | 'action'; timing: string; explicit: boolean };
};
export type Allocation = RecordBase & {
  assetId: string;
  goalId: string;
  amount: string;
  unit: Candidate['unit'];
  start: string;
  end: string;
  scenario: string;
  certainty: Candidate['certainty'];
  funding: '현재 자산' | '미래 적립금' | '미확인';
};
export type ConditionalFund = RecordBase & {
  amount: string;
  unit: Candidate['unit'];
  certainty: Candidate['certainty'];
  approval: '승인' | '미승인' | '미확인';
  received: '수령' | '미수령' | '미확인';
  reflectedAt: string;
  destination: '현재 자산' | '확정 수입' | '예상 시나리오' | '미반영' | '미확인';
  scenario: string;
};
export const actions = ['유지', '중단', '시작', '증액', '감액', '미확인'] as const;
export type PlanAction = RecordBase & {
  targetId: string;
  side: '제안' | '실행' | '미확인';
  action: (typeof actions)[number];
  amount: string;
  unit: Candidate['unit'];
  start: string;
  end: string;
  scenario: string;
};
export type Planning = {
  asOf: string;
  allocations: Allocation[];
  funds: ConditionalFund[];
  actions: PlanAction[];
};
export const emptyPlanning = (): Planning => ({
  asOf: '',
  allocations: [],
  funds: [],
  actions: [],
});
export function newRecord(kind: 'allocation', id: string): Allocation;
export function newRecord(kind: 'fund', id: string): ConditionalFund;
export function newRecord(kind: 'action', id: string): PlanAction;
/** 직접 추가한 계획도 원본 근거와 필수 조건을 확인하기 전까지 확정하지 않는다. */
export function newRecord(kind: 'allocation' | 'fund' | 'action', id: string): Allocation | ConditionalFund | PlanAction {
  const base: RecordBase = {
    id,
    label: '새 항목',
    confirmed: false,
    excluded: false,
    references: [],
    candidateIds: [],
    note: '원본의 대상·조건·적용 범위를 확인하세요.',
    origin: '직접 입력',
  };
  if (kind === 'allocation')
    return {
      ...base,
      assetId: '',
      goalId: '',
      amount: '',
      unit: '미확인',
      start: '',
      end: '',
      scenario: '',
      certainty: '미확인',
      funding: '미확인',
    };
  if (kind === 'fund')
    return {
      ...base,
      amount: '',
      unit: '미확인',
      certainty: '미확인',
      approval: '미확인',
      received: '미확인',
      reflectedAt: '',
      destination: '미확인',
      scenario: '',
    };
  return {
    ...base,
    targetId: '',
    side: '미확인',
    action: '미확인',
    amount: '',
    unit: '미확인',
    start: '',
    end: '',
    scenario: '',
  };
}
