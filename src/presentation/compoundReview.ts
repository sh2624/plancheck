import type { ReviewedFinding } from './findingGroups';
import type { Planning, PlanAction } from '../planning/types';
import type { EvidenceRef, Result } from '../validation/types';
import type { ReviewChoice } from '../inspection/review';
import { normalize } from '../normalization/values';
import { formatFinancial } from './format';
export type CompoundReview = {
  kind: 'allocation' | 'fund' | 'action';
  title: string;
  values: { label: string; value: string }[];
  meaning: string;
  question: string;
  choices: Record<ReviewChoice, string>;
  responses: Record<ReviewChoice, string>;
};
const key = (ref: EvidenceRef) => JSON.stringify([ref.source, ref.fileName, ref.location, ref.originalText]);
const money = (n: number | null) => (n === null ? '금액 미확인' : formatFinancial(n / 10000, '만 원'));
/** 빈 날짜·시나리오를 구분자로 직렬화하지 않고 기존 원본 행을 읽는 설명만 만든다. */
export function readableBasis(result: Result, planning: Planning, refs: EvidenceRef[]) {
  if (result.code !== 'PLAN_CONFLICT') return result.basis;
  const rows = planning.actions.filter(
    (row) => result.id === `action:${row.id}` || result.id.startsWith(`actions:${row.id}:`) || result.id.endsWith(`:${row.id}`),
  );
  const sentences = rows.map((row) => {
    const amount = row.amount.trim()
      ? money(['원', '만 원', '억 원'].includes(row.unit) ? normalize(row.amount, row.unit) : null)
      : '금액 미기재';
    const period =
      row.start && row.end
        ? `${row.start}부터 ${row.end}까지`
        : row.start
          ? `${row.start}부터 · 종료일 미확인`
          : row.end
            ? `${row.end}까지 · 시작일 미확인`
            : '적용 기간 미확인';
    const monthly = /월\s*\d[\d,]*(?:\.\d+)?\s*(?:만\s*원|억\s*원|원)/.test(row.references.map((ref) => ref.originalText).join(' '));
    return `${stage(row, refs)}: ${row.targetId || '대상 미확인'} ${monthly ? '월 ' : ''}${amount} ${row.action}. ${period}${row.scenario.trim() ? ` · 시나리오 ${row.scenario}` : ''}`;
  });
  return `${sentences.join('. ')}${sentences.length ? '. ' : ''}같은 대상의 적용 기간과 행동을 비교합니다. 조건이 다르거나 미확인이면 충돌을 확정하지 않습니다.`;
}
/** 근거의 실제 앞선 단계 제목만 표시한다. 단계가 없으면 제안/실행만 표시한다. */
function stage(row: PlanAction, refs: EvidenceRef[]) {
  const ref = row.references[0];
  if (!ref) return row.side;
  let label = '',
    found = false;
  for (const r of refs.filter((r) => r.source === ref.source && r.fileName === ref.fileName)) {
    const number = r.originalText.match(/(?:^|\s)(\d+)\s*단계/)?.[1];
    if (number) label = `${number}단계`;
    if (key(r) === key(ref)) {
      found = true;
      break;
    }
  }
  return label && found ? `${label} · ${row.side}` : row.side;
}
/** 원본 구조화 값으로 요약만 만든다. 응답은 기존 same/different/unknown 값이며 승인·계산은 변경하지 않는다. */
export function compoundReview(f: ReviewedFinding, planning: Planning, refs: EvidenceRef[]): CompoundReview | undefined {
  const r = f.result;
  if (f.approved || !r.reviewHint) return;
  const sources = new Set((r.references ?? []).map(key));
  const related = (row: { references: EvidenceRef[] }) => row.references.some((ref) => sources.has(key(ref)));
  if (r.code === 'ALLOC_CAPACITY') {
    const asset = r.evidence.find((c) => ['deposit', 'etf', 'pension', 'housingDeposit'].includes(c.field));
    const deposit = asset?.field === 'deposit' && /예금/.test(asset.label);
    const two = r.evidence.filter((c) => c.field === 'goalAmount').length === 2;
    return {
      kind: 'allocation',
      title: deposit ? `같은 예금을 ${two ? '두' : '여러'} 목표에 사용했을 수 있습니다` : '같은 자금을 여러 목표에 사용했을 수 있습니다',
      values: [
        { label: deposit ? '보유 예금' : '보유 자산', value: money(r.expected) },
        { label: '배정 계획 · 총액', value: money(r.actual) },
      ],
      meaning:
        r.difference === null
          ? '사용 시점과 자금 출처를 확인해야 합니다.'
          : `동일한 시점에 사용한다면 ${money(Math.abs(r.difference))} 부족합니다.`,
      question: deposit ? '두 목표에 같은 예금을 같은 시점에 사용하나요?' : '여러 목표에 같은 자금을 같은 시점에 사용하나요?',
      choices: {
        same: deposit ? '예, 같은 예금을 동시에 사용합니다.' : '예, 같은 자금을 동시에 사용합니다.',
        different: '아니요, 다른 자금이나 사용 시점입니다.',
        unknown: '확인할 수 없습니다.',
      },
      responses: {
        same: '같은 자금·동시 사용이라는 답변을 기록했습니다. 정확한 날짜는 생성하지 않았으며, 보유액 기준 등 최종 검증 조건은 아직 미확인입니다.',
        different: '다른 자금 또는 시점으로 보류했습니다. 배정 근거는 유지하며, 필요하면 상세 검토에서 재원·기간을 수정하세요.',
        unknown: '자금·사용 시점을 확인할 수 없어 보류했습니다. 원문에서 재원과 사용 기간을 확인하세요.',
      },
    };
  }
  if (r.code === 'PLAN_CONDITIONAL') {
    const funds = planning.funds.filter(related);
    const future = funds.some((row) => /후|미래/.test(row.relation?.timing ?? ''));
    return {
      kind: 'fund',
      title: future ? '확정되지 않은 금액이 미래 자산에 포함됐을 수 있습니다' : '확정되지 않은 금액이 자산에 포함됐을 수 있습니다',
      values: funds.length
        ? funds.map((row) => ({
            label: `${row.label}${row.amount && row.certainty === '가정' ? ' 예상액' : ''}`,
            value: money(['원', '만 원', '억 원'].includes(row.unit) ? normalize(row.amount, row.unit) : null),
          }))
        : [{ label: r.title, value: money(r.actual) }],
      meaning: future
        ? '미래 예상 자산에 포함된 문맥이며, 반영 가능 여부는 확인이 필요합니다.'
        : '자산 반영 문맥이 있습니다. 지급·수령 조건과 반영 시점은 별도 확인 대상입니다.',
      question: '이 금액은 지급·수령 조건이 확정되었고, 표시된 시점에 반영 가능한 금액인가요?',
      choices: {
        same: '예, 조건과 반영 시점이 확인됐습니다.',
        different: '아니요, 아직 확정되지 않았습니다.',
        unknown: '확인할 수 없습니다.',
      },
      responses: {
        same: '조건·시점에 대한 답변을 기록했습니다. 지급 승인·실제 수령·반영일은 상세 검토에서 각각 확인해야 하며, 최종 판정은 아직 보류됩니다.',
        different:
          '아직 확정되지 않았다는 답변으로 보류했습니다. 예상 시나리오의 반영 자체가 오류는 아닙니다. 지급 조건과 반영처를 확인하세요.',
        unknown: '지급·수령 조건과 반영 시점을 확인할 수 없어 보류했습니다. 원문과 지급 근거를 확인하세요.',
      },
    };
  }
  if (r.code === 'PLAN_CONFLICT') {
    const rows = planning.actions.filter((row) => related(row) && (r.id.startsWith(`actions:${row.id}:`) || r.id.endsWith(`:${row.id}`)));
    const proposal = rows.find((row) => row.side === '제안'),
      execution = rows.find((row) => row.side === '실행');
    if (!proposal || !execution) return;
    const noun = (row: PlanAction) => {
      const text = row.references.map((ref) => ref.originalText).join(' ');
      return /자동이체/.test(text)
        ? '자동이체'
        : /적립/.test(text)
          ? '적립'
          : /투자/.test(text)
            ? '투자'
            : /저축/.test(text)
              ? '저축'
              : '행동';
    };
    const target = proposal.targetId,
      etf = /ETF/i.test(target),
      stopKeep = proposal.action === '중단' && execution.action === '유지' && noun(proposal) === '적립' && noun(execution) === '자동이체';
    return {
      kind: 'action',
      title: stopKeep
        ? `${target} 적립 중단과 자동이체 유지 계획이 함께 있습니다`
        : `${target} ${proposal.action} 제안과 ${execution.action} 실행 계획이 함께 있습니다`,
      values: rows.map((row) => ({
        label: stage(row, refs),
        value: `${/월\s*\d[\d,]*(?:\.\d+)?\s*(?:억\s*원|만\s*원|원)/.test(row.references.map((ref) => ref.originalText).join(' ')) ? '월 ' : ''}${money(['원', '만 원', '억 원'].includes(row.unit) ? normalize(row.amount, row.unit) : null)} · ${noun(row)} ${row.action}`,
      })),
      meaning: '같은 적립과 적용 기간이라면 두 계획이 충돌할 수 있습니다.',
      question: `두 계획은 같은 ${etf ? 'ETF' : '상품'}의 동일 기간 적립을 말하나요?`,
      choices: {
        same: `예, 같은 ${etf ? 'ETF' : '상품'}와 기간입니다.`,
        different: '아니요, 상품이나 적용 기간이 다릅니다.',
        unknown: '확인할 수 없습니다.',
      },
      responses: {
        same: `같은 상품·기간이라는 답변을 기록했습니다. ${rows.some((row) => !row.start || !row.end) ? '시작·종료일을 상세 검토에서 확인하고, 원문에 없으면 미확인으로 보류하세요.' : '구조화한 적용 조건을 상세 검토에서 확인하세요.'} 아직 충돌 확정은 아닙니다.`,
        different: '다른 상품 또는 적용 기간으로 보류했습니다. 필요하면 상세 검토에서 대상과 기간을 수정하세요.',
        unknown: '상품·기간을 확인할 수 없어 보류했습니다. 두 계획의 적용 범위를 원문에서 확인하세요.',
      },
    };
  }
}
