import type { Proposal } from './contract';
import type { EvidenceRef } from '../validation/types';
import type { Planning } from '../planning/types';
import { newRecord } from '../planning/types';
import { units, type Unit } from '../normalization/types';
/** 기존 단위에 대응하는 원문 숫자만 편집 후보로 옮긴다. */
function amount(e: Proposal['evidence'][number]) {
  const unit = e.unit?.replace('만원', '만 원').replace('억원', '억 원');
  return { amount: e.number ?? '', unit: units.includes(unit as Unit) ? (unit as Unit) : ('미확인' as const) };
}
/** AI 관계는 대상 ID·기간·승인을 비워 둔 확인 후보로만 기존 편집기에 전달한다. */
export function importProposal(planning: Planning, proposal: Proposal, references: EvidenceRef[], id: string): Planning {
  const base = {
    label: proposal.evidence.map((e) => e.target).join(' / '),
    confirmed: false,
    references,
    note: `AI 문맥 제안 — ${proposal.uncertainty}`,
    origin: '자동 후보' as const,
  };
  if (proposal.kind === 'allocation')
    return { ...planning, allocations: [...planning.allocations, { ...newRecord('allocation', id), ...base }] };
  if (proposal.kind === 'conditional_fund')
    return {
      ...planning,
      funds: [
        ...planning.funds,
        { ...newRecord('fund', id), ...base, ...(proposal.evidence.length === 1 ? amount(proposal.evidence[0]) : {}) },
      ],
    };
  return {
    ...planning,
    actions: [
      ...planning.actions,
      ...proposal.evidence.map((e, i) => ({ ...newRecord('action', `${id}-${i}`), ...base, label: e.target })),
    ],
  };
}
