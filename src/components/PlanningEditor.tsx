import { useState, useEffect, useRef } from 'react';
import type { Candidate } from '../normalization/types';
import { units } from '../normalization/types';
import type { EvidenceRef } from '../validation/types';
import { Button } from './ui/button';
import { actions, newRecord } from '../planning/types';
import type { Planning, Allocation, ConditionalFund, PlanAction } from '../planning/types';
type Kind = 'allocations' | 'funds' | 'actions';
type Patch = Partial<Allocation & ConditionalFund & PlanAction>;
type Props = {
  focus?: { kind: Kind; id: string };
  initiallyOpen?: boolean;
  state: Planning;
  items: Candidate[];
  references: EvidenceRef[];
  onChange: (next: Planning) => void;
};
/** 자산 배정·조건부 금액·행동 후보를 원본과 연결하고 필요한 항목만 선택적으로 확인한다. */
export function PlanningEditor({ state, items, references, onChange, focus, initiallyOpen = true }: Props) {
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (focus) {
      root.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      root.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    }
  }, [focus]);
  const [kind, setKind] = useState<Kind>(focus?.kind ?? 'allocations'),
    [selected, setSelected] = useState(focus?.id ?? '');
  const rows = state[kind],
    record = rows.find((r) => r.id === selected) ?? rows[0];
  function update(patch: Patch) {
    if (!record) return;
    onChange({
      ...state,
      [kind]: rows.map((r) => (r.id === record.id ? { ...r, ...patch, confirmed: patch.confirmed ?? false } : r)),
    });
  }
  function add() {
    const id = crypto.randomUUID();
    const row = kind === 'allocations' ? newRecord('allocation', id) : kind === 'funds' ? newRecord('fund', id) : newRecord('action', id);
    onChange({ ...state, [kind]: [row, ...rows] });
    setSelected(id);
  }
  const text = (label: string, value: string, key: keyof Patch, type = 'text') => (
    <label>
      {label}
      <input type={type} value={value} onChange={(e) => update({ [key]: e.target.value })} />
    </label>
  );
  const choice = (label: string, value: string, key: keyof Patch, options: readonly string[]) => (
    <label>
      {label}
      <select value={value} onChange={(e) => update({ [key]: e.target.value })}>
        {options.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
    </label>
  );
  const pick = (label: string, value: string, key: 'assetId' | 'goalId', fields: Candidate['field'][]) => (
    <label>
      {label}
      <select value={value} onChange={(e) => update({ [key]: e.target.value })}>
        <option value="">선택</option>
        {items
          .filter((c) => !c.excluded && fields.includes(c.field))
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} · {c.number} {c.unit} · {c.location} · {c.confirmed ? '확인됨' : '미확인'}
            </option>
          ))}
      </select>
    </label>
  );
  const allocation = kind === 'allocations' ? (record as Allocation) : undefined,
    fund = kind === 'funds' ? (record as ConditionalFund) : undefined,
    action = kind === 'actions' ? (record as PlanAction) : undefined;
  return (
    <details ref={root} className="planning-editor" open={initiallyOpen}>
      <summary>자금 배정 및 계획 확인</summary>
      <p className="notice">
        문장 후보는 자동 확정하지 않습니다. 자산·목표액은 ‘데이터 확인’에서 먼저 확인하고, 아래 구조화 정보도 원문에 맞게 확인하세요. 기간은
        시작·종료일을 모두 포함하며, 대체 시나리오는 이름을 구분합니다. ‘통과’는 해당 규칙의 한정된 검사 결과입니다.
      </p>
      <label className="planning-asof">
        현재 반영 검토 기준일
        <input type="date" value={state.asOf} onChange={(e) => onChange({ ...state, asOf: e.target.value })} />
      </label>
      <div className="steps">
        {(
          [
            ['allocations', '자산·목표 배정'],
            ['funds', '조건부 금액'],
            ['actions', '제안·실행 행동'],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            variant={kind === key ? 'default' : 'outline'}
            onClick={() => {
              setKind(key);
              setSelected('');
            }}
          >
            {label} ({state[key].length})
          </Button>
        ))}
      </div>
      <div className="planning-select">
        <label>
          구조화 항목
          <select value={record?.id ?? ''} onChange={(e) => setSelected(e.target.value)}>
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.excluded ? '[제외] ' : r.confirmed ? '[확인] ' : '[미확인] '}
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <Button variant="outline" onClick={add}>
          구조화 항목 추가
        </Button>
      </div>
      {record ? (
        <>
          <div className="planning-grid">
            {text('구조화 항목명', record.label, 'label')}
            {allocation && (
              <>
                {pick('사용할 보유 자산', allocation.assetId, 'assetId', ['deposit', 'etf', 'pension', 'housingDeposit'])}
                {pick('연결할 목표액', allocation.goalId, 'goalId', ['goalAmount'])}
                {text('배정액', allocation.amount, 'amount')}
                {choice('배정 단위', allocation.unit, 'unit', units)}
                {choice('배정 상태', allocation.certainty, 'certainty', ['확정', '가정', '조건부', '미확인'])}
                {choice('자금 구분', allocation.funding, 'funding', ['현재 자산', '미래 적립금', '미확인'])}
                {text('사용 시작일', allocation.start, 'start', 'date')}
                {text('사용 종료일', allocation.end, 'end', 'date')}
                {text('배정 시나리오', allocation.scenario, 'scenario')}
              </>
            )}
            {fund && (
              <>
                {text('조건부 금액', fund.amount, 'amount')}
                {choice('조건부 금액 단위', fund.unit, 'unit', units)}
                {choice('금액 확정 여부', fund.certainty, 'certainty', ['확정', '가정', '조건부', '미확인'])}
                {choice('지급·가입 승인', fund.approval, 'approval', ['승인', '미승인', '미확인'])}
                {choice('실제 수령', fund.received, 'received', ['수령', '미수령', '미확인'])}
                {text('계획 반영일', fund.reflectedAt, 'reflectedAt', 'date')}
                {choice('계획 반영처', fund.destination, 'destination', ['현재 자산', '확정 수입', '예상 시나리오', '미반영', '미확인'])}
                {text('금액 시나리오', fund.scenario, 'scenario')}
              </>
            )}
            {action && (
              <>
                {text('대상 ID (동일 행동 대상을 같은 이름으로 연결)', action.targetId, 'targetId')}
                {choice('계획 구분', action.side, 'side', ['제안', '실행', '미확인'])}
                {choice('제안·실행 행동', action.action, 'action', actions)}
                {text('행동 금액 (미기재 가능)', action.amount, 'amount')}
                {choice('행동 금액 단위', action.unit, 'unit', units)}
                {text('행동 시작일', action.start, 'start', 'date')}
                {text('행동 종료일', action.end, 'end', 'date')}
                {text('행동 시나리오', action.scenario, 'scenario')}
              </>
            )}
            <label>
              원본 문맥 연결
              <select
                value=""
                onChange={(e) => {
                  const ref = references[Number(e.target.value)];
                  if (e.target.value !== '' && ref) update({ references: [ref] });
                }}
              >
                <option value="">원본 행·문단 선택 (기존 근거 교체)</option>
                {references.map((r, i) => (
                  <option key={`${r.source}:${r.fileName}:${r.location}`} value={i}>
                    {r.source} · {r.location} · {r.originalText.slice(0, 90)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              추출 항목 연결 (선택 사항)
              <select
                multiple
                size={4}
                value={record.candidateIds}
                onChange={(e) =>
                  update({
                    candidateIds: Array.from(e.target.selectedOptions).map((o) => o.value),
                  })
                }
              >
                {items
                  .filter((c) => !c.excluded)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.source} {c.label} · {c.location} · {c.confirmed ? '확인됨' : '미확인'}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <p className="muted">
            {record.origin} · {record.note}
          </p>
          {record.references.map((r, i) => (
            <div className="planning-evidence" key={i}>
              <strong>
                {r.source} · {r.fileName} · {r.location}
              </strong>
              <p className="pre">{r.originalText}</p>
            </div>
          ))}
          <label className="scope-confirm">
            <input
              type="checkbox"
              checked={record.confirmed}
              disabled={record.excluded}
              onChange={(e) => update({ confirmed: e.target.checked })}
            />
            원본과 대상·금액·조건·기간·시나리오를 확인했습니다.
          </label>
          <Button variant="outline" onClick={() => update({ excluded: !record.excluded })}>
            {record.excluded ? '구조화 항목 복원' : '구조화 항목 제외'}
          </Button>
        </>
      ) : (
        <p className="empty">등록된 구조화 항목이 없습니다. 실제 원문에서 확인한 배정·조건·행동을 추가하세요.</p>
      )}
    </details>
  );
}
