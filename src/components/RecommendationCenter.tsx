import { useState, useRef, useEffect } from 'react';
import type { Candidate, Link } from '../normalization/types';
import { fieldLabels, units } from '../normalization/types';
import { canConfirm } from '../normalization/values';
import type { Calculation } from '../validation/types';
import { rules } from '../validation/types';
import type { Recommendation } from '../recommendations/types';
import { Button } from './ui/button';
import { formatFinancial } from '../presentation/format';
type Props = {
  focus?: { id: string; kind: string };
  recommendations: Recommendation[];
  items: Candidate[];
  links: Link[];
  calculations: Calculation[];
  onEdit: (id: string, patch: Partial<Candidate>) => void;
  onApply: (r: Recommendation, approve: boolean) => void;
  onInspect: (ids: string[]) => void;
  onPlan: (r: Recommendation) => void;
};
/** 추천 근거와 원본을 먼저 보여주고 선택한 구성에 대해서만 사용자의 명시적 승인을 받는다. */
export function RecommendationCenter(props: Props) {
  const { recommendations, links, calculations, onInspect, onPlan } = props;
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (props.focus) {
      root.current?.scrollIntoView?.({ block: 'start' });
      root.current?.querySelector('summary')?.focus();
    }
  }, [props.focus]);
  const [kind, setKind] = useState(props.focus?.kind ?? '전체'),
    [extra, setExtra] = useState(!!props.focus),
    [selected, setSelected] = useState(props.focus?.id ?? ''),
    [page, setPage] = useState(0),
    [open, setOpen] = useState(true);
  const visible = recommendations.filter(
    (r) => (kind === '전체' || r.kind === kind) && (extra || r.primary || kind === 'PLAN' || kind === 'ALLOC'),
  );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visible.length / 10) - 1)),
    detail = recommendations.find((r) => r.id === selected);
  function state(r: Recommendation) {
    if (r.planFocus && r.reviewed) return '구조화 확인됨';
    if (r.link && links.some((l) => l.xlsxId === r.link!.xlsxId && l.docxId === r.link!.docxId)) return '연결 승인됨';
    if (r.calculation) {
      const c = calculations.find((c) => c.id === r.calculation!.id);
      if (c) return c.scopeConfirmed ? '범위 승인됨' : '구성 적용됨 · 확인 필요';
    }
    return '미승인 추천';
  }
  return (
    <details ref={root} className="recommendation-center" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>자동 검증 후보 추천 · 핵심 {recommendations.filter((r) => r.primary).length}건</summary>
      <p className="notice">
        추천 신뢰도는 사용자 확인과 다릅니다. 원문과 기준을 확인한 항목만 승인하세요. 숫자가 같은지는 연결 기준에 사용하지 않으며,
        가정·조건부·다른 시점은 승인 후에도 보류될 수 있습니다.
      </p>
      <div className="recommendation-filters">
        <label>
          추천 종류
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setSelected('');
              setPage(0);
            }}
          >
            {['전체', 'CALC', 'CROSS', 'ALLOC', 'PLAN'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={extra}
            onChange={(e) => {
              setExtra(e.target.checked);
              setSelected('');
              setPage(0);
            }}
          />
          반복·추가·불확실 후보 포함
        </label>
        <span className="muted">
          전체 {recommendations.length}건 중 {visible.length}건 표시
        </span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>검증 추천</th>
              <th>추출 신뢰 상태 / 승인</th>
              <th>추가 확인</th>
            </tr>
          </thead>
          <tbody>
            {visible.slice(currentPage * 10, (currentPage + 1) * 10).map((r) => (
              <tr key={r.id}>
                <td>
                  <Button variant="outline" onClick={() => setSelected(r.id)}>
                    {r.kind} · {r.title}
                  </Button>
                </td>
                <td>
                  {r.confidence}
                  <br />
                  {state(r)}
                </td>
                <td>{r.missing.slice(0, 2).join(' · ') || r.risks.slice(0, 2).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && <p className="empty">표시할 핵심 추천이 없습니다. 파일을 업로드하거나 추가·불확실 후보를 확인하세요.</p>}
      <div className="pagination">
        <Button variant="outline" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>
          이전 추천
        </Button>
        <span>
          {currentPage + 1} / {Math.max(1, Math.ceil(visible.length / 10))}
        </span>
        <Button variant="outline" disabled={(currentPage + 1) * 10 >= visible.length} onClick={() => setPage(currentPage + 1)}>
          다음 추천
        </Button>
      </div>
      {detail && (
        <RecommendationDetail
          key={detail.id}
          {...props}
          recommendation={detail}
          onInspect={onInspect}
          onPlan={onPlan}
          onApplied={() => setOpen(false)}
        />
      )}
    </details>
  );
}
export function RecommendationDetail({
  recommendation: r,
  items,
  onEdit,
  onApply,
  onInspect,
  onPlan,
  onApplied,
  headline,
}: Props & {
  recommendation: Recommendation;
  onApplied: () => void;
  headline?: string;
}) {
  const [ack, setAck] = useState(false);
  const members = r.candidateIds.map((id) => items.find((c) => c.id === id)).filter((c): c is Candidate => !!c);
  const valid =
    !r.scopeIssues?.length &&
    members.length > 0 &&
    members.length === r.candidateIds.length &&
    members.every(canConfirm) &&
    (!r.calculation ||
      rules[r.calculation.rule].groups.every(
        (g) => (r.calculation!.groups[g.key]?.length ?? 0) > 0 && (g.many || r.calculation!.groups[g.key].length === 1),
      ));
  const edit = (id: string, patch: Partial<Candidate>) => {
    setAck(false);
    onEdit(id, patch);
  };
  return (
    <section className="recommendation-detail" aria-label="추천 근거 검토">
      <h3>{headline ?? `${r.kind} · ${r.title}`}</h3>
      <p>{r.reason}</p>
      {[...r.risks, ...r.missing].map((n, i) => (
        <p className="warning" key={i}>
          {n}
        </p>
      ))}
      {members.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>원본 항목·위치</th>
                <th>현재 수치·단위</th>
                <th>기준·상태</th>
              </tr>
            </thead>
            <tbody>
              {members.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>
                      {c.source} · {fieldLabels[c.field]} · {c.label}
                    </strong>
                    <p>
                      {c.fileName} · {c.location}
                    </p>
                    <details>
                      <summary>원본 문맥</summary>
                      <p className="pre">{c.originalText}</p>
                      <p>원본 숫자: {c.originalNumber ?? '없음'}</p>
                    </details>
                    <small>
                      {c.confidence} · {c.confirmed ? '사용자 확인됨' : '사용자 미확인'}
                    </small>
                  </td>
                  <td>
                    <label>
                      추천 숫자
                      <input value={c.number} onChange={(e) => edit(c.id, { number: e.target.value })} />
                    </label>
                    <label>
                      추천 단위
                      <select
                        value={c.unit}
                        onChange={(e) =>
                          edit(c.id, {
                            unit: e.target.value as Candidate['unit'],
                          })
                        }
                      >
                        {units.map((u) => (
                          <option key={u}>{u}</option>
                        ))}
                      </select>
                    </label>
                    <p>
                      정규화:{' '}
                      {c.normalizedValue === null
                        ? '확인 필요'
                        : formatFinancial(c.normalizedValue, ['원', '만 원', '억 원'].includes(c.unit) ? '원' : c.unit)}
                    </p>
                  </td>
                  <td>
                    <label>
                      추천 기준일
                      <input value={c.asOf} onChange={(e) => edit(c.id, { asOf: e.target.value })} />
                    </label>
                    <label>
                      추천 적용 기간
                      <input value={c.period} onChange={(e) => edit(c.id, { period: e.target.value })} />
                    </label>
                    <label>
                      추천 시나리오
                      <input value={c.scenario} onChange={(e) => edit(c.id, { scenario: e.target.value })} />
                    </label>
                    <label>
                      추천 확정 여부
                      <select
                        value={c.certainty}
                        onChange={(e) =>
                          edit(c.id, {
                            certainty: e.target.value as Candidate['certainty'],
                          })
                        }
                      >
                        {['미확인', '확정', '가정', '조건부'].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.references.map((ref, i) => (
        <div className="planning-evidence" key={i}>
          <strong>
            {ref.source} · {ref.fileName} · {ref.location}
          </strong>
          <p className="pre">{ref.originalText}</p>
        </div>
      ))}
      {(r.calculation || r.link) && (
        <>
          <label className="scope-confirm">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            선택 원문의 수치·단위·항목 의미
            {r.link ? '와 동일 항목 연결' : ' 및 구성 범위의 누락·소계 중복 여부'}를 검토했습니다. 기준일·시나리오·확정 여부는 위 입력
            상태를 유지합니다.
            {r.calculation?.rule === 'loan' ? ' 같은 대출의 고정금리·거치기간·원금/잔여기간 기준도 확인했습니다.' : ''}
          </label>
          <div className="steps">
            {r.calculation && (
              <Button variant="outline" onClick={() => onApply(r, false)}>
                추천 구성만 적용
              </Button>
            )}
            <Button
              disabled={!ack || !valid}
              onClick={() => {
                onApply(r, true);
                onApplied();
              }}
            >
              선택 값 확인·검증 승인
            </Button>
          </div>
        </>
      )}
      <div className="steps">
        {members.length > 0 && (
          <Button variant="outline" onClick={() => onInspect(r.candidateIds)}>
            해당 데이터 확인 화면으로 이동
          </Button>
        )}
        {(r.kind === 'PLAN' || r.kind === 'ALLOC') && (
          <Button variant="outline" onClick={() => onPlan(r)}>
            {r.allocation ? '배정 후보 가져와 조건 확인' : '구조화 조건 확인으로 이동'}
          </Button>
        )}
      </div>
    </section>
  );
}
