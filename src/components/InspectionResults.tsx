import { useState, useRef, useEffect } from 'react';
import type { InspectionInput } from '../inspection/analyze';
import type { Recommendation } from '../recommendations/types';
import type { Candidate } from '../normalization/types';
import type { Result } from '../validation/types';
import type { ReviewChoice, InlineAnswers } from '../inspection/review';
import { groupFindings, findingSection, findingType, resultSections, type ReviewedFinding } from '../presentation/findingGroups';
import { formatFinancial } from '../presentation/format';
import { groupDiscoveries } from '../presentation/discoveries';
import { compoundReview, readableBasis } from '../presentation/compoundReview';
import { comparisonFormat } from '../presentation/comparison';
import { reviewCompletion } from '../presentation/reviewCompletion';
import { candidateValue } from '../presentation/workflow';
import { RecommendationDetail } from './RecommendationCenter';
import { InlineReview } from './InlineReview';
import { QuestionReview } from './QuestionReview';
import { Button } from './ui/button';
import { reviewQuality, filterQuality, contextMismatch, qualityTiers } from '../inspection/quality';
import { fieldLabels } from '../normalization/types';
const kinds = {
  CALC: '계산',
  CROSS: '문서 간 비교',
  ALLOC: '자금 배정',
  PLAN: '조건부 금액·계획',
};
const statusLabels: Record<Result['status'], string> = {
  오류: '확인된 오류',
  '확인 필요': '비교 기준 확인됨 · 확인 필요',
  '검증 통과': '검사 통과',
  '검증 불가': '아직 검사할 수 없음',
};
type Props = InspectionInput & {
  findings: ReviewedFinding[];
  started: boolean;
  onEdit: (id: string, patch: Partial<Candidate>) => void;
  onApply: (r: Recommendation, approve: boolean) => void;
  onInspect: (ids: string[]) => void;
  onPlan: (r: Recommendation) => void;
  onStart: () => void;
  onPrepare: (result: Result) => void;
  onInlineReview: (r: Recommendation, choice: ReviewChoice, answers: InlineAnswers) => string[];
  onPlanReview?: (finding: ReviewedFinding, choice: ReviewChoice) => void;
};
function explanation(f: ReviewedFinding) {
  if (f.approved?.status === '오류')
    return '사용자가 확인한 관계와 적용 조건에서 차이가 검출됐습니다. 원본을 대조해 수정할 내용을 확인하세요.';
  if (f.approved?.status === '검증 통과') return '확인한 항목과 검사 범위에서 통과했습니다. 다른 범위의 정상 여부까지 뜻하지 않습니다.';
  if ((f.approved ?? f.result).status === '검증 불가') return '검사에 필요한 값이나 관계가 부족합니다. 근거에서 누락 조건을 확인하세요.';
  return f.kind === 'CROSS'
    ? f.signal === '수치 차이'
      ? '두 값의 대상과 비교 기준이 같은지 확인해 주세요.'
      : '숫자만으로 동일 항목을 확정하지 않습니다. 관계와 적용 기준을 확인해 주세요.'
    : '계산에 포함된 항목과 적용 조건을 확인해 주세요.';
}
/** 계산 범위의 검토 답변만 기존 결정 모델에 기록한다. 범위·수치 승인을 대신하지 않는다. */
function calculationPrompt(f: ReviewedFinding) {
  if (f.kind !== 'CALC' || !f.recommendation?.calculation) return;
  return {
    title: f.title,
    question: '계산에 포함된 항목이 빠짐없이 같은 범위에 해당하나요?',
    choices: {
      same: '예, 구성 범위를 확인했습니다.',
      different: '아니요, 구성이 다르거나 빠진 항목이 있습니다.',
      unknown: '확인할 수 없습니다.',
    },
    responses: {
      same: '구성 범위에 대한 답변을 저장했습니다. 수치·기간·확정 여부의 최종 승인은 상세 검토에서 별도로 확인합니다.',
      different: '구성 수정이 필요하다는 답변을 저장했습니다. 기존 계산 근거를 보존하며 상세 검토에서 항목을 수정할 수 있습니다.',
      unknown: '구성 범위를 확인할 수 없다는 답변을 저장했습니다. 최종 오류 판정은 보류합니다.',
    },
  };
}
/** 독립적인 우선 발견을 먼저 보여주고 추가·파생·보류 기록도 근거별로 유지한다. */
export function InspectionResults(props: Props) {
  const { findings, started, onInspect } = props;
  const [kind, setKind] = useState('전체'),
    [expandRelated, setExpandRelated] = useState(false),
    [selected, setSelected] = useState(''),
    [lastReviewed, setLastReviewed] = useState(''),
    [complex, setComplex] = useState(false),
    [field, setField] = useState('전체'),
    [showAdditional, setShowAdditional] = useState(false),
    [showRecords, setShowRecords] = useState(false),
    [followId, setFollowId] = useState(''),
    [openSupports, setOpenSupports] = useState<Record<string, boolean>>({});
  const detailRef = useRef<HTMLElement>(null),
    feedbackRef = useRef<HTMLElement>(null),
    feedbackPending = useRef(false),
    rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected) {
      detailRef.current?.scrollIntoView?.({ block: 'nearest' });
      detailRef.current?.focus();
    }
  }, [selected]);
  const quality = reviewQuality(findings),
    discoveries = groupDiscoveries(quality),
    visibleDiscoveries = discoveries.filter((d) => filterQuality(d.members, field, kind).length > 0),
    representatives = visibleDiscoveries.map((d) => d.representative),
    filtered = filterQuality(quality, field, kind),
    qualityMap = new Map(quality.map((e) => [e.finding.id, e])),
    followTier = visibleDiscoveries.find((d) => d.members.some((e) => e.occurrences.some((f) => f.id === followId)))?.representative.tier;
  const tierEntries = (tier: string) => representatives.filter((e) => e.tier === tier);
  const fields: string[] = [...new Set<string>(quality.map((e) => e.finding.result.evidence[0]?.field ?? 'planning'))];
  const reviewed = findings.find((f) => f.id === lastReviewed && f.decision);
  const reviewedSummary = reviewed
    ? (compoundReview(reviewed, props.planning, props.references) ?? calculationPrompt(reviewed))
    : undefined;
  const reviewedChoice = reviewed?.decision?.choice;
  const completedReview = reviewed ? reviewCompletion(reviewed, reviewedSummary?.choices) : undefined;
  useEffect(() => {
    if (!selected && feedbackPending.current && lastReviewed && reviewedChoice) {
      feedbackPending.current = false;
      feedbackRef.current?.scrollIntoView?.({ block: 'nearest' });
      feedbackRef.current?.focus();
    }
  }, [lastReviewed, reviewedChoice, selected]);
  function close(id: string) {
    setSelected('');
    setFollowId(id);
    requestAnimationFrame(() =>
      Array.from(rootRef.current?.querySelectorAll<HTMLElement>('.finding, .finding-support') ?? [])
        .find((el) => el.dataset.finding === id)
        ?.focus(),
    );
  }
  function card(f: ReviewedFinding, detailed = false) {
    const r = f.approved ?? f.result,
      section = findingSection(f),
      entry = qualityMap.get(f.id)!;
    const summary = compoundReview(f, props.planning, props.references);
    const discovery = discoveries.find((d) => d.members.some((e) => e.finding === f));
    const supports = detailed ? [] : (discovery?.members.filter((e) => e.finding !== f) ?? []);
    const supportFollow = supports.some((e) => e.occurrences.some((record) => record.id === followId));
    // 대표에 묶인 동일 원본 비교만 함께 보여준다. 다른 원본을 임의 선택하지 않는다.
    const comparison =
      !detailed && f.kind === 'CALC' && !f.approved && r.expected !== null
        ? discovery?.members
            .map((e) => e.finding)
            .find(
              (other) =>
                other.kind === 'CROSS' &&
                !other.approved &&
                !other.relationship?.blocked &&
                !contextMismatch(other) &&
                !['different', 'unknown'].includes(other.decision?.choice ?? '') &&
                other.signal === '수치 차이' &&
                other.result.evidence.length === 2 &&
                other.result.evidence.some((c) => c.id === r.evidence[0]?.id) &&
                other.result.evidence.every((c) => c.field === r.evidence[0]?.field) &&
                other.result.evidence.some((c) => c.id !== r.evidence[0]?.id && c.normalizedValue === r.expected),
            )
        : undefined;
    const valueEvidence = comparison?.result.evidence ?? r.evidence;
    const reviewPrompt = summary ?? (!comparison ? calculationPrompt(f) : undefined);
    const inlineCompound = !!reviewPrompt && !!props.onPlanReview && !complex;
    const reviewFinding = comparison ?? f;
    const decision = f.decision ?? comparison?.decision;
    const completion = reviewCompletion(
      { ...(f.decision ? f : reviewFinding), decision, approved: f.approved ?? reviewFinding.approved },
      reviewPrompt?.choices ?? (f.decision ? calculationPrompt(f)?.choices : undefined),
    );
    const formatted = comparisonFormat(valueEvidence, r.unit);
    const displayTitle =
      r.unit === '원' && r.difference !== null
        ? f.title.replace(formatFinancial(Math.abs(r.difference), '원', { difference: true }), formatted.difference(r.difference))
        : f.title;
    const proofEvidence = [...new Map([...r.evidence, ...(comparison?.result.evidence ?? [])].map((c) => [c.id, c])).values()];
    const status =
      completion?.status ??
      (f.approved ? statusLabels[f.approved.status] : section === resultSections[3] ? '추가 정보 필요' : '검사 중 발견 · 확인 필요');
    return (
      <article
        className={detailed ? 'finding-support py-4 border-t' : 'finding'}
        data-finding={f.id}
        data-review-kind={summary?.kind}
        data-tier={entry.tier}
        key={f.id}
        tabIndex={-1}
      >
        <p className="finding-type">{findingType(f)}</p>
        <div className="finding-heading">
          <h3>
            {summary
              ? summary.title
              : comparison
                ? `${r.title} 수치가 두 문서에서 다릅니다`
                : !f.approved &&
                    f.kind === 'CROSS' &&
                    f.signal === '수치 차이' &&
                    !contextMismatch(f) &&
                    ['totalAssets', 'surplus'].includes(r.evidence[0]?.field ?? '')
                  ? `${fieldLabels[r.evidence[0].field]} 수치가 두 문서에서 다릅니다`
                  : f.relationship?.blocked
                    ? '자동 연결에서 제외한 원본 기록'
                    : !f.approved && contextMismatch(f)
                      ? `${fieldLabels[r.evidence[0]?.field ?? 'unknown']} · 적용 기준이 다른 비교 기록`
                      : !f.approved && f.kind === 'PLAN'
                        ? `${r.title.replace(/^(조건부 금액|제안·실행 비교|대응 계획 필요) · /, '')} — ${f.title}`
                        : displayTitle}
          </h3>
          <span
            className={
              section === resultSections[0]
                ? 'result-error'
                : section === resultSections[2]
                  ? 'result-pass'
                  : section === resultSections[3]
                    ? 'result-unavailable'
                    : 'result-review'
            }
          >
            {status}
          </span>
        </div>
        <div className="finding-values">
          {summary ? (
            summary.values.map((value, i) => (
              <p key={i}>
                <span>{value.label}</span>
                <strong>{value.value}</strong>
              </p>
            ))
          ) : f.kind === 'CALC' && !comparison && r.expected !== null && r.evidence[0] ? (
            <>
              <p>
                <span>
                  {r.evidence[0].source === 'XLSX' ? 'Excel' : 'Word'} · {r.evidence[0].label}
                </span>
                <strong>{formatted.value(r.actual)}</strong>
              </p>
              <p>
                <span>{['CALC_ASSETS', 'CALC_DEBT'].includes(r.code) ? `구성 항목 ${r.evidence.length - 1}개 합계` : '재계산 결과'}</span>
                <strong>{formatted.value(r.expected)}</strong>
              </p>
            </>
          ) : (
            valueEvidence.slice(0, f.kind === 'CROSS' || comparison ? 2 : 4).map((c) => (
              <p key={c.id}>
                <span>
                  {c.source === 'XLSX' ? 'Excel' : 'Word'} · {c.label}
                </span>
                <strong>
                  {r.unit === '원' && ['원', '만 원', '억 원'].includes(c.unit) && c.normalizedValue !== null
                    ? formatted.value(c.normalizedValue)
                    : candidateValue(c)}
                </strong>
              </p>
            ))
          )}
        </div>
        {!summary && !r.evidence.length && (
          <p className="finding-comparison">
            {r.references?.[0]?.source === 'XLSX' ? 'Excel' : 'Word'} ·{' '}
            {r.actual === null ? '금액·관계 미확인' : `원문 금액 후보 ${formatFinancial(r.actual, r.unit)}`}
          </p>
        )}
        {!summary && r.difference !== null && (!contextMismatch(f) || !!f.decision) && (
          <p className="finding-comparison">
            {f.kind === 'CROSS' || comparison ? '두 값의 차이' : f.kind === 'ALLOC' ? '같은 시점 사용 시 초과액' : '문서값과 계산값 차이'}:{' '}
            <strong>{formatted.difference(r.difference)}</strong>
            {f.kind === 'CALC' && !comparison && <> · 재계산 {formatFinancial(r.expected, r.unit)}</>}
          </p>
        )}
        <p className="finding-description">
          {completion
            ? completion.answer
            : summary
              ? summary.meaning
              : !f.decision && !f.approved && (f.relationship?.blocked || contextMismatch(f))
                ? entry.reasons[0]
                : explanation(f)}
        </p>
        {summary && !decision && selected !== f.id && <p className="finding-question">{summary.question}</p>}
        {selected !== f.id && (
          <div className="finding-actions">
            <Button
              onClick={() => {
                if (reviewPrompt && props.onPlanReview) {
                  setComplex(false);
                  setSelected(f.id);
                } else if (f.relationship?.blocked) {
                  onInspect(r.evidence.map((c) => c.id));
                } else if (f.recommendation) {
                  setSelected(f.id);
                  setComplex(!reviewFinding.recommendation?.link);
                } else props.onPrepare(r);
              }}
            >
              {f.relationship?.blocked ? '문서 내용 확인·수정' : f.approved ? '확인 내용 수정' : decision ? '답변 수정' : '이 항목 검토'}
            </Button>
          </div>
        )}
        {selected === f.id && inlineCompound && reviewPrompt && props.onPlanReview && (
          <section ref={detailRef} tabIndex={-1} className="focused-review compound-review" aria-label="선택 항목 상세 검토">
            <QuestionReview
              question={reviewPrompt.question}
              choices={reviewPrompt.choices}
              value={f.decision?.choice}
              onSave={(choice) => {
                feedbackPending.current = true;
                props.onPlanReview?.(f, choice);
                setLastReviewed(f.id);
                setSelected('');
                setFollowId(f.id);
              }}
              onAdvanced={() => {
                if (f.kind === 'CALC') setComplex(true);
                else {
                  setSelected('');
                  props.onPrepare(r);
                }
              }}
              onClose={() => close(f.id)}
            />
          </section>
        )}
        {selected === f.id && !inlineCompound && reviewFinding.recommendation && (
          <section ref={detailRef} tabIndex={-1} className="focused-review" aria-label="선택 항목 상세 검토">
            {!complex && reviewFinding.recommendation.link ? (
              <InlineReview
                key={f.id}
                finding={reviewFinding}
                items={props.items}
                onApply={(choice, answers) => {
                  const issues = props.onInlineReview(reviewFinding.recommendation!, choice, answers);
                  if (!issues.length) {
                    feedbackPending.current = true;
                    setLastReviewed(reviewFinding.id);
                    setSelected('');
                    setFollowId(f.id);
                  }
                  return issues;
                }}
                onComplex={() => setComplex(true)}
                onClose={() => close(f.id)}
              />
            ) : (
              <>
                <RecommendationDetail
                  key={f.id}
                  {...props}
                  recommendations={[]}
                  recommendation={reviewFinding.recommendation}
                  headline={f.title}
                  onApplied={() => close(f.id)}
                />
                <Button variant="outline" onClick={() => close(f.id)}>
                  상세 검토 닫기
                </Button>
              </>
            )}
          </section>
        )}
        <details
          className={detailed ? 'finding-support-proof' : 'finding-proof'}
          open={detailed || supportFollow || (supports.length > 0 && expandRelated) ? true : undefined}
          onToggle={(e) => {
            if (!e.currentTarget.open && supportFollow) setFollowId('');
          }}
        >
          <summary>{detailed ? '개별 검사 근거' : '판단 근거 보기'}</summary>
          <p>
            검토 분류: {entry.tier} · {entry.reasons.join(' ')}
          </p>
          {entry.occurrences.length > 1 && (
            <p>
              같은 원본 쌍·관계·근거의 완전 중복 {entry.occurrences.length}건을 합쳤습니다. 기록 ID:{' '}
              {entry.occurrences.map((f) => f.id).join(', ')}
            </p>
          )}
          <p className="pre">{readableBasis(r, props.planning, props.references)}</p>
          {!detailed && discovery?.explanation && <p>{discovery.explanation}</p>}
          {comparison && <p className="pre">문서 간 비교 근거: {comparison.result.basis}</p>}
          {proofEvidence.map((c) => (
            <div className="finding-evidence" key={c.id}>
              <strong>
                {c.source} · {c.fileName} · {c.location}
              </strong>
              <p className="pre">{c.originalText || '직접 입력'}</p>
              <small>
                기준일 {c.asOf || '미확인'} · 시나리오 {c.scenario || '미확인'} · 적용 기간 {c.period || '미확인'} · {c.certainty}
                <br />
                추출: {c.method} · {c.confidence} · {c.confirmed ? '사용자 확인됨' : '사용자 미확인'}
              </small>
            </div>
          ))}
          {r.references?.map((ref, i) => (
            <div className="finding-evidence" key={i}>
              <strong>
                {ref.fileName} · {ref.location}
              </strong>
              <p className="pre">{ref.originalText}</p>
            </div>
          ))}
          <ul>
            {(f.approved ? f.approved.needs : f.questions).map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
          {f.recommendation && (
            <p className="muted">
              연결 근거: {f.recommendation.reason} · {f.recommendation.confidence}
            </p>
          )}
          <small>검증 규칙 {r.code}</small>
          <div className="finding-actions">
            <Button variant="outline" disabled={!r.evidence.length} onClick={() => onInspect(r.evidence.map((c) => c.id))}>
              문서 내용 확인·수정
            </Button>
          </div>
          {supports.length > 0 && (
            <details
              className="discovery-supports"
              open={expandRelated || supportFollow || !!openSupports[f.id]}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setOpenSupports((previous) => (previous[f.id] === open ? previous : { ...previous, [f.id]: open }));
              }}
            >
              <summary>같은 발견의 다른 검사 근거 {supports.length}건</summary>
              {(expandRelated || supportFollow || openSupports[f.id]) && supports.map((e) => card(e.finding, true))}
            </details>
          )}
        </details>
      </article>
    );
  }
  if (!started)
    return (
      <section className="inspection-results empty" aria-label="자동 검사 결과">
        <h2>두 문서를 등록하고 검사를 시작하세요</h2>
        <p>항목이나 검사 규칙을 먼저 설정할 필요가 없습니다. 문서가 바뀌면 다시 검사해야 합니다.</p>
        <Button onClick={props.onStart}>검사 시작 화면으로</Button>
      </section>
    );
  function grouped(tier: string) {
    const entries = tierEntries(tier),
      groups = groupFindings(entries.map((e) => e.finding)).flatMap((s) => s.groups);
    if (!entries.length) return <p className="section-empty">이 범위에 표시할 결과가 없습니다.</p>;
    return groups.map((group) => (
      <div className="finding-group" key={group.map((f) => f.id).join('|')}>
        {card(group[0])}
        {group.length > 1 && (
          <details className="related-findings" open={expandRelated || group.slice(1).some((f) => f.id === followId)}>
            <summary>공유 원본의 추가 기록 {group.length - 1}건 · 개별 근거 유지</summary>
            {group.slice(1).map((f) => card(f))}
          </details>
        )}
      </div>
    ));
  }
  return (
    <section ref={rootRef} className="inspection-results" aria-label="자동 검사 결과">
      <div className="inspection-heading">
        <h2>검사 결과</h2>
        <span>필요한 항목만 확인하세요</span>
      </div>
      <div className="inspection-counts">
        <strong>확인된 오류 {discoveries.filter((d) => d.members.some((e) => e.finding.approved?.status === '오류')).length}</strong>
        <span>우선 확인할 문제 {discoveries.filter((d) => d.representative.tier === qualityTiers[0]).length}개</span>
      </div>
      {reviewed && reviewed.decision && (
        <aside ref={feedbackRef} tabIndex={-1} className="compound-feedback" role="status">
          <strong>{reviewedSummary?.title ?? reviewed.title}</strong>
          <p>{completedReview?.answer}</p>
          <p>
            {completedReview?.conclusion} {completedReview?.next}
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setComplex(false);
              setFollowId(reviewed.id);
              setSelected(reviewed.id);
            }}
          >
            이 답변 다시 검토
          </Button>
        </aside>
      )}
      <div className="inspection-filters">
        <label>
          재무 항목
          <select
            aria-label="재무 항목"
            value={field}
            onChange={(e) => {
              setField(e.target.value);
              setFollowId('');
            }}
          >
            <option value="전체">전체 항목</option>
            {fields.map((key) => (
              <option key={key} value={key}>
                {key === 'planning' ? '계획·조건부 금액' : fieldLabels[key as keyof typeof fieldLabels]}
              </option>
            ))}
          </select>
        </label>
        <details className="quality-filter-options">
          <summary>추가 필터</summary>
          <label>
            오류 유형
            <select aria-label="오류 유형" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="전체">전체 유형</option>
              {Object.entries(kinds).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" checked={expandRelated} onChange={(e) => setExpandRelated(e.target.checked)} />
            공유 원본 기록 모두 펼치기
          </label>
        </details>
      </div>
      <section className="finding-section quality-priority" aria-label="우선 검토">
        <h2>
          우선 확인할 문제 <span>{tierEntries(qualityTiers[0]).length}개</span>
        </h2>
        <p className="quality-caption">답변을 저장하면 일반 검토가 완료됩니다. 최종 오류 판정은 별도입니다.</p>
        {!tierEntries(qualityTiers[0]).length && (
          <p className="section-empty">
            우선 검토할 독립 발견이 없습니다. 추가 검토와 상세 분석 기록을 확인하세요. 정상 판정이라는 뜻은 아닙니다.
          </p>
        )}
        {tierEntries(qualityTiers[0]).map((e) => card(e.finding))}
      </section>
      <details
        className="quality-extra"
        open={showAdditional || followTier === qualityTiers[1]}
        onToggle={(e) => {
          setShowAdditional(e.currentTarget.open);
          if (!e.currentTarget.open) setFollowId('');
        }}
      >
        <summary>
          추가 확인 <span>{tierEntries(qualityTiers[1]).length}건 · 대상·기간·조건 확인</span>
        </summary>
        <section aria-label="추가 검토">{grouped(qualityTiers[1])}</section>
      </details>
      <details
        className="quality-records"
        open={showRecords || followTier === qualityTiers[2]}
        onToggle={(e) => {
          setShowRecords(e.currentTarget.open);
          if (!e.currentTarget.open) setFollowId('');
        }}
      >
        <summary>
          상세 분석 기록 <span>{tierEntries(qualityTiers[2]).length}건 · 반복·조건 차이·보류·통과 기록</span>
        </summary>
        <section aria-label="상세 분석 기록">
          <p className="quality-caption analysis-count">
            {filtered.length}개 분석 기록 · 전체 {quality.length}개
            {findings.length > quality.length && ` · 완전 중복 ${findings.length - quality.length}건 합침`}
          </p>
          <p className="quality-caption">
            자동 수치 차이 후보{' '}
            {
              quality.filter(
                (e) =>
                  !e.finding.approved &&
                  e.finding.signal === '수치 차이' &&
                  !e.finding.relationship?.blocked &&
                  !contextMismatch(e.finding),
              ).length
            }
            건 · 반복 원본 포함
          </p>
          <p className="quality-caption">
            원본과 개별 근거를 모두 보존합니다. 부적합한 연결은 비교에서 제외했으며, 보류는 통과가 아닙니다.
          </p>
          {grouped(qualityTiers[2])}
        </section>
      </details>
    </section>
  );
}
