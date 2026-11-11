import { useMemo, useState, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Candidate, Link } from '../normalization/types';
import { Button } from './ui/button';
import { newCalculation, rules, ruleTitles } from '../validation/types';
import type { Calculation, Rule, Status, Result } from '../validation/types';
import { presentResult, displayValue } from '../presentation/results';
import { validateAll } from '../validation/engine';
import { validatePlanning } from '../planning/engine';
import { emptyPlanning } from '../planning/types';
import type { Planning } from '../planning/types';
import type { EvidenceRef } from '../validation/types';
import { PlanningEditor } from './PlanningEditor';
import { candidateValue } from '../presentation/workflow';
import { formatFinancial } from '../presentation/format';
type Props = {
  calculationFocus?: { id: string; request: string };
  onPrepare?: (result: Result) => void;
  approvalVersion?: number;
  recommendationPanel?: ReactNode;
  sessionPanel?: ReactNode;
  planFocus?: {
    kind: 'allocations' | 'funds' | 'actions';
    id: string;
    request: string;
  };
  planning?: Planning;
  references?: EvidenceRef[];
  onPlanningChange?: (next: Planning) => void;
  items: Candidate[];
  links: Link[];
  calculations: Calculation[];
  onChange: (next: Calculation[]) => void;
  onInspect: (ids: string[]) => void;
};
const statusClass: Record<Status, string> = {
  오류: 'result-error',
  '확인 필요': 'result-review',
  '검증 통과': 'result-pass',
  '검증 불가': 'result-unavailable',
};
/** 선택 범위 설정과 현재 데이터로 계산한 결과를 표시하며 모든 판정의 원본 근거를 연다. */
export function ResultsView({
  calculationFocus,
  onPrepare,
  approvalVersion = 0,
  recommendationPanel,
  sessionPanel,
  planFocus,
  planning = emptyPlanning(),
  references = [],
  onPlanningChange,
  items,
  links,
  calculations,
  onChange,
  onInspect,
}: Props) {
  const settingsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!calculationFocus || !settingsRef.current) return;
    settingsRef.current.open = true;
    const fieldset = Array.from(settingsRef.current.querySelectorAll('fieldset')).find(
      (el) => el.dataset.calculation === calculationFocus.id,
    );
    (fieldset ?? settingsRef.current).scrollIntoView?.({ block: 'start' });
    fieldset?.focus();
  }, [calculationFocus]);
  const [selected, setSelected] = useState(''),
    [filterState, setFilterState] = useState({
      value: recommendationPanel ? '판정 결과' : '전체',
      version: approvalVersion,
    }),
    [addRule, setAddRule] = useState<Rule>('assets');
  const filter = filterState.version === approvalVersion ? filterState.value : recommendationPanel ? '판정 결과' : '전체';
  const setFilter = (value: string) => setFilterState({ value, version: approvalVersion });
  const results = useMemo(
    () => [...validateAll(items, links, calculations), ...validatePlanning(items, planning)],
    [items, links, calculations, planning],
  );
  const priority: Record<Status, number> = {
    오류: 0,
    '확인 필요': 1,
    '검증 통과': 2,
    '검증 불가': 3,
  };
  const visible = results
    .filter((r) => filter === '전체' || (filter === '판정 결과' && r.status !== '검증 불가') || r.status === filter)
    .sort((a, b) => priority[a.status] - priority[b.status]);
  const detail = results.find((r) => r.id === selected);
  const detailPresentation = detail ? presentResult(detail) : undefined;
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected) {
      detailRef.current?.scrollIntoView?.({
        block: 'start',
        behavior: 'smooth',
      });
      detailRef.current?.focus({ preventScroll: true });
    }
  }, [selected]);
  const describe = (c: Candidate) =>
    `${c.label} · ${candidateValue(c)} · ${c.source} ${c.location} · ${c.period || '기간 미확인'} · ${c.confirmed ? '확인됨' : '미확인'}`;
  function update(id: string, patch: Partial<Calculation>) {
    onChange(calculations.map((s) => (s.id === id ? { ...s, ...patch, scopeConfirmed: patch.scopeConfirmed ?? false } : s)));
  }
  const choose = (label: string, fields: string[], value: string[], many: boolean, onSelect: (ids: string[]) => void) => (
    <label className="calculation-picker">
      {label}
      <select
        multiple={many}
        size={many ? 5 : 1}
        value={many ? value : (value[0] ?? '')}
        onChange={(e) => onSelect(many ? Array.from(e.target.selectedOptions).map((o) => o.value) : e.target.value ? [e.target.value] : [])}
      >
        {!many && <option value="">선택</option>}
        {items
          .filter((c) => !c.excluded && fields.includes(c.field))
          .map((c) => (
            <option key={c.id} value={c.id}>
              {describe(c)}
            </option>
          ))}
      </select>
    </label>
  );
  return (
    <section className={`results ${recommendationPanel ? 'results-prioritized' : ''}`} aria-label="검수 결과">
      <div className="review-toolbar">
        <h2>핵심 검증</h2>
        <span className="muted">확인된 항목만 판정 · 승인 연결 {links.length}개</span>
      </div>
      <p className="notice">
        전체 후보를 확인할 필요는 없습니다. 계산에 쓸 항목만 확인하고 범위를 선택하세요. 같은 항목의 반복 출현과 소계를 함께 합산하지
        마세요. 기준일·시나리오·확정 여부가 불명확하면 확정 오류로 판정하지 않습니다.
      </p>
      <div className="result-counts">
        {(['오류', '확인 필요', '검증 통과', '검증 불가'] as const).map((status) => (
          <button
            type="button"
            key={status}
            className={statusClass[status]}
            aria-pressed={filter === status}
            onClick={() => setFilter(filter === status ? '전체' : status)}
          >
            {status} {results.filter((r) => r.status === status).length}
          </button>
        ))}
      </div>
      <label className="review-filter">
        결과 필터
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          {['판정 결과', '전체', '오류', '확인 필요', '검증 통과', '검증 불가'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>검수 항목</th>
              <th>상태</th>
              <th>Excel 값·위치</th>
              <th>Word 값·위치</th>
              <th>문서값 / 비교·계산값 / 차이</th>
              <th>판단 근거 / 확인 사항</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const presentation = presentResult(r);
              return (
                <tr key={r.id}>
                  <td>
                    <button type="button" className="result-link" onClick={() => setSelected(r.id)}>
                      <span className="result-title">{presentation.headline}</span>
                      <small className="result-code">
                        {r.code} · {r.title}
                      </small>
                    </button>
                  </td>
                  <td>
                    {r.status === '검증 불가' && <strong className="preparation-title">검증 준비 중</strong>}
                    <span className={`${statusClass[r.status]} ${r.status === '검증 불가' ? 'preparation-label' : ''}`}>{r.status}</span>
                  </td>
                  {(['XLSX', 'DOCX'] as const).map((source) => (
                    <td key={source}>
                      {r.evidence
                        .filter((c) => c.source === source)
                        .map((c, i) => (
                          <p key={`${c.id}:${i}`}>
                            {c.label}: {candidateValue(c)}
                            <br />
                            {c.fileName} · {c.location}
                          </p>
                        ))}
                      {r.references
                        ?.filter((ref) => ref.source === source)
                        .map((ref, i) => (
                          <p key={`ref:${i}`}>
                            {ref.fileName} · {ref.location}
                          </p>
                        ))}
                    </td>
                  ))}
                  <td>
                    <p>문서값: {displayValue(r.actual, r.unit)}</p>
                    <p>비교·계산값: {displayValue(r.expected, r.unit)}</p>
                    <p>차이: {displayValue(r.difference, r.unit === '%' ? '%p' : r.unit)}</p>
                  </td>
                  <td>
                    <p className="result-explanation">{presentation.description}</p>
                    <p className="result-next">다음 행동: {presentation.nextAction}</p>
                    {r.needs
                      .filter((n) => n !== presentation.nextAction)
                      .map((n, i) => (
                        <p className="warning" key={i}>
                          {n}
                        </p>
                      ))}
                    {onPrepare && (r.status === '검증 불가' || r.status === '확인 필요') && (
                      <Button variant="outline" onClick={() => onPrepare(r)}>
                        {r.code.startsWith('PLAN') || r.code.startsWith('ALLOC') ? '구조화 조건 확인' : '추천 검토·승인'}
                      </Button>
                    )}
                    <details>
                      <summary>계산·판단 근거</summary>
                      <p>{r.basis}</p>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!visible.length && (
        <p className="empty">
          {results.length
            ? filter === '판정 결과'
              ? '아직 판정할 결과가 없습니다. 아래 준비 중 항목에서 필요한 값·범위를 확인하세요.'
              : '선택한 상태의 결과가 없습니다. 다른 상태나 전체 결과를 확인하세요.'
            : '표시할 검증 결과가 없습니다. 계산을 설정하거나 문서 간 연결을 승인하세요.'}
        </p>
      )}
      {recommendationPanel && (
        <details className="preparation-list">
          <summary>검증 준비 중 {results.filter((r) => r.status === '검증 불가').length}건 · 필요한 확인 보기</summary>
          <p className="muted">필수 값이나 사용자 확인이 부족한 항목입니다. 실패 또는 정상으로 판정한 결과가 아닙니다.</p>
          <ul>
            {results
              .filter((r) => r.status === '검증 불가')
              .map((r) => (
                <li key={r.id}>
                  <div>
                    <strong>{r.title}</strong>
                    <p>{r.needs[0] ?? '원본의 값과 적용 조건을 확인하세요.'}</p>
                  </div>
                  <Button variant="outline" onClick={() => onPrepare?.(r)}>
                    필요한 항목 확인
                  </Button>
                </li>
              ))}
          </ul>
        </details>
      )}
      {detail && (
        <section ref={detailRef} tabIndex={-1} className="result-detail" aria-label="검증 근거 상세">
          <h3>{detailPresentation?.headline}</h3>
          <small className="result-code">
            {detail.code} · {detail.status}
          </small>
          <p className="result-explanation">{detailPresentation?.description}</p>
          <p className="result-next">다음 행동: {detailPresentation?.nextAction}</p>
          {onPrepare && (detail.status === '검증 불가' || detail.status === '확인 필요') && (
            <Button variant="outline" onClick={() => onPrepare(detail)}>
              검증 준비 이어가기
            </Button>
          )}
          <p>{detail.basis}</p>
          {detail.needs.map((n, i) => (
            <p className="warning" key={i}>
              {n}
            </p>
          ))}
          {detail.evidence.map((c, i) => (
            <article key={`${c.id}:${i}`}>
              <strong>{describe(c)}</strong>
              <p>
                {c.fileName} · 기준일 {c.asOf || '미확인'} · 시나리오 {c.scenario || '미확인'} · {c.certainty}
              </p>
              <p className="pre">{c.originalText || '직접 입력'}</p>
              <p>
                원본 숫자 {c.originalNumber ?? '없음'} · 현재 정규화 값{' '}
                {formatFinancial(c.normalizedValue, ['원', '만 원', '억 원'].includes(c.unit) ? '원' : c.unit)}
              </p>
            </article>
          ))}
          {detail.references?.map((ref, i) => (
            <article key={`ref:${i}`}>
              <strong>
                {ref.source} · {ref.fileName} · {ref.location}
              </strong>
              <p className="pre">{ref.originalText}</p>
            </article>
          ))}
          <Button disabled={!detail.evidence.length} variant="outline" onClick={() => onInspect(detail.evidence.map((c) => c.id))}>
            문서 내용 확인·수정
          </Button>
        </section>
      )}
      {recommendationPanel && <div className="recommendation-panel">{recommendationPanel}</div>}
      {sessionPanel && <div className="session-panel">{sessionPanel}</div>}
      <details ref={settingsRef} className="calculation-settings" open={!recommendationPanel}>
        <summary>계산 범위 및 대출 조건</summary>
        <p className="muted">
          복수 선택은 Ctrl 또는 Shift와 함께 선택합니다. 합계 검증은 선택한 항목의 완전성을 사용자가 확인해야 합니다. 지출·저축이 없으면
          확인된 0원 항목을 직접 추가하세요.
        </p>
        {calculations.map((s, index) => (
          <fieldset key={s.id} data-calculation={s.id} tabIndex={-1}>
            <legend>
              {index + 1}. {ruleTitles[s.rule]}
            </legend>
            <div className="calculation-grid">
              {choose('검사할 문서값', [rules[s.rule].target], s.targetId ? [s.targetId] : [], false, (ids) =>
                update(s.id, { targetId: ids[0] ?? '' }),
              )}
              {rules[s.rule].groups.map((g) => (
                <div key={g.key}>
                  {choose(g.label, g.fields, s.groups[g.key] ?? [], g.many, (ids) =>
                    update(s.id, { groups: { ...s.groups, [g.key]: ids } }),
                  )}
                </div>
              ))}
              <label>
                허용오차 (원)
                <input inputMode="decimal" value={s.tolerance} onChange={(e) => update(s.id, { tolerance: e.target.value })} />
              </label>
              {s.rule === 'loan' && (
                <>
                  <label>
                    상환방식
                    <select
                      value={s.loanMethod}
                      onChange={(e) =>
                        update(s.id, {
                          loanMethod: e.target.value as Calculation['loanMethod'],
                        })
                      }
                    >
                      {['미확인', '원리금균등', '기타'].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    원금·기간 기준
                    <select
                      value={s.loanBasis}
                      onChange={(e) =>
                        update(s.id, {
                          loanBasis: e.target.value as Calculation['loanBasis'],
                        })
                      }
                    >
                      {['미확인', '최초 원금·전체 기간', '현재 잔액·잔여 기간'].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    거치기간 (개월, 없으면 0)
                    <input inputMode="numeric" value={s.graceMonths} onChange={(e) => update(s.id, { graceMonths: e.target.value })} />
                  </label>
                  <p className="muted">
                    같은 대출의 고정 연금리와 원금·기간 조합을 선택하세요. 거치 0개월만 지원하며 수수료·보험료는 포함하지 않습니다.
                  </p>
                </>
              )}
            </div>
            <label className="scope-confirm">
              <input type="checkbox" checked={s.scopeConfirmed} onChange={(e) => update(s.id, { scopeConfirmed: e.target.checked })} />
              선택한 항목이 동일 범위·기간에 속하고 구성 항목 누락·소계 중복이 없음을 확인했습니다.
              {s.rule === 'loan' ? ' 같은 대출의 고정금리 약정·거치 및 기간 기준도 확인했습니다.' : ''}
            </label>
            <Button variant="outline" onClick={() => onInspect([s.targetId, ...Object.values(s.groups).flat()].filter(Boolean))}>
              선택 항목 확인·수정
            </Button>
            <Button variant="outline" onClick={() => onChange(calculations.filter((c) => c.id !== s.id))}>
              계산 설정 삭제
            </Button>
          </fieldset>
        ))}
        <div className="manual-link">
          <label>
            추가할 계산
            <select value={addRule} onChange={(e) => setAddRule(e.target.value as Rule)}>
              {Object.entries(ruleTitles).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <Button variant="outline" onClick={() => onChange([...calculations, newCalculation(addRule, crypto.randomUUID())])}>
            계산 추가
          </Button>
        </div>
      </details>
      {onPlanningChange && (
        <PlanningEditor
          key={planFocus?.request ?? 'planning'}
          focus={planFocus}
          initiallyOpen={!recommendationPanel || !!planFocus}
          state={planning}
          items={items}
          references={references}
          onChange={onPlanningChange}
        />
      )}
    </section>
  );
}
