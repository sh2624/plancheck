import { useState, useMemo, useRef, useEffect } from 'react';
import { FileCheck2 } from 'lucide-react';
import { DocumentPanel } from './components/DocumentPanel';
import { WorkbookView } from './components/WorkbookView';
import { WordView } from './components/WordView';
import { ReviewView } from './components/ReviewView';
import { ResultsView } from './components/ResultsView';
import { newCalculation, ruleTitles } from './validation/types';
import type { Calculation, Rule, Result } from './validation/types';
import { Button } from './components/ui/button';
import { parseXlsx } from './parsers/xlsx';
import { parseDocx } from './parsers/docx';
import { extractWorkbook, extractWord } from './normalization/extract';
import { editCandidate, canConfirm } from './normalization/values';
import { removeLinks } from './normalization/links';
import type { Candidate, Link } from './normalization/types';
import type { EvidenceRef } from './validation/types';
import { emptyPlanning } from './planning/types';
import { workbookReferences, wordReferences, replacePlanningSource } from './planning/extract';
import { newRecord } from './planning/types';
import { recommend } from './recommendations/recommend';
import { applyRecommendation } from './recommendations/apply';
import type { Recommendation } from './recommendations/types';
import { RecommendationCenter } from './components/RecommendationCenter';
import { SessionReview } from './components/SessionReview';
import type { Documents } from './session/checkpoint';
import { StepGuide } from './components/StepGuide';
import { DocumentSummary } from './components/DocumentSummary';
import { coreCandidates, reviewProgress } from './presentation/workflow';
import { validateAll } from './validation/engine';
import { validatePlanning } from './planning/engine';
import { presentResult } from './presentation/results';
import { inspectDocuments } from './inspection/analyze';
import { InspectionResults } from './components/InspectionResults';
import { assessRelationship } from './normalization/relationships';
import {
  applyInlineReview,
  reviewFingerprint,
  planReviewFingerprint,
  removeDecisions,
  type ReviewDecision,
  type ReviewChoice,
  type InlineAnswers,
} from './inspection/review';
/** 원본 추출과 사용자 확인 상태를 관리하며 파일 교체 시 관련 연결을 해제한다. */
export default function App() {
  const revision = useRef(0);
  const [step, setStep] = useState<'raw' | 'review' | 'results'>('raw');
  const [guides, setGuides] = useState({
    raw: true,
    review: true,
    results: true,
  });
  const [registered, setRegistered] = useState({ XLSX: false, DOCX: false });
  const [inspectionStatus, setInspectionStatus] = useState<'ready' | 'running' | 'complete'>('ready');
  const inspectionRun = useRef({ generation: 0 });
  const inspectionStarted = inspectionStatus === 'complete';
  useEffect(() => {
    const run = inspectionRun.current;
    return () => {
      run.generation++;
    };
  }, []);
  /** 진행 문구를 그린 뒤 검사를 실행하며 파일 교체로 취소된 요청은 결과를 열지 않는다. */
  async function startInspection() {
    if (!registered.XLSX || !registered.DOCX || inspectionStatus === 'running') return;
    const ticket = ++inspectionRun.current.generation;
    setInspectionStatus('running');
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (ticket !== inspectionRun.current.generation) return;
    setInspectionStatus('complete');
    setStep('results');
    setAdvancedOpen(false);
  }
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [inlineDecisions, setInlineDecisions] = useState<Record<string, ReviewDecision>>({});
  const [focusIds, setFocusIds] = useState<string[]>([]);
  const [planning, setPlanning] = useState(emptyPlanning);
  const [sourceReferences, setSourceReferences] = useState<EvidenceRef[]>([]);
  const [documents, setDocuments] = useState<Documents>({});
  const [recommendationFocus, setRecommendationFocus] = useState<{
    id: string;
    kind: string;
    request: string;
  }>();
  const [approvalVersion, setApprovalVersion] = useState(0);
  const [calculationFocus, setCalculationFocus] = useState<{
    id: string;
    request: string;
  }>();
  const [planFocus, setPlanFocus] = useState<{
    kind: 'allocations' | 'funds' | 'actions';
    id: string;
    request: string;
  }>();
  const [calculations, setCalculations] = useState<Calculation[]>(() =>
    Object.keys(ruleTitles).map((rule) => newCalculation(rule as Rule, rule)),
  );
  const [review, setReview] = useState<{ items: Candidate[]; links: Link[] }>({
    items: [],
    links: [],
  });
  const recommendations = useMemo(
    () => recommend(review.items, review.links, planning, sourceReferences),
    [review.items, review.links, planning, sourceReferences],
  );
  const coreIds = coreCandidates(review.items, recommendations);
  const findings = useMemo(
    () =>
      inspectionStarted
        ? inspectDocuments({
            compoundDiscovery: import.meta.env.VITE_ENABLE_COMPOUND_DISCOVERY !== 'false',
            items: review.items,
            links: review.links,
            calculations,
            planning,
            references: sourceReferences,
          }).map((f) => {
            const decision = inlineDecisions[f.id];
            return {
              ...f,
              decision:
                decision &&
                decision.fingerprint === reviewFingerprint(review.items, decision.candidateIds) &&
                (!decision.planningFingerprint ||
                  decision.planningFingerprint === planReviewFingerprint(planning, f.result.references ?? []))
                  ? decision
                  : undefined,
            };
          })
        : [],
    [inspectionStarted, review, calculations, planning, sourceReferences, inlineDecisions],
  );
  const progress = reviewProgress(review.items, coreIds);
  const results = useMemo(
    () => [...validateAll(review.items, review.links, calculations), ...validatePlanning(review.items, planning)],
    [review, calculations, planning],
  );
  const pendingResult =
    results.find((r) => r.code === 'CROSS_VALUE' && r.status !== '오류' && r.status !== '검증 통과') ??
    results.find((r) => r.status === '검증 불가' || r.status === '확인 필요');
  const unapproved = recommendations.find(
    (r) =>
      r.primary &&
      (r.link
        ? !review.links.some((l) => l.xlsxId === r.link!.xlsxId && l.docxId === r.link!.docxId)
        : r.calculation
          ? !calculations.some((c) => c.id === r.calculation!.id && c.scopeConfirmed)
          : !r.reviewed),
  );
  /** 누락된 파일의 등록 위치로 이동하고 키보드 초점을 맞춘다. */
  function register(source: 'XLSX' | 'DOCX') {
    setStep('raw');
    requestAnimationFrame(() => {
      const input = document.getElementById(source === 'XLSX' ? 'xlsx' : 'docx');
      input?.scrollIntoView?.({ block: 'center' });
      input?.focus();
    });
  }
  /** 등록·확인·승인·판정 상태에 맞춰 지금 수행할 한 가지 행동을 제시한다. */
  function nextAction() {
    if (!registered.XLSX)
      return {
        text: 'Excel 재무표가 없습니다. 먼저 파일을 등록하세요.',
        label: 'Excel 등록',
        run: () => register('XLSX'),
      };
    if (!registered.DOCX)
      return {
        text: 'Word 보고서를 등록하면 두 문서의 값을 비교할 수 있습니다.',
        label: 'Word 등록',
        run: () => register('DOCX'),
      };
    if (step === 'raw')
      return {
        text: '두 문서가 등록됐습니다. 핵심 항목의 값과 원본부터 확인하세요.',
        label: '데이터 확인으로 이동',
        run: () => {
          setFocusIds([]);
          setStep('review');
        },
      };
    if (step === 'review' && progress.pending.length)
      return {
        text: `핵심 확인 대상 ${progress.total}개 중 ${progress.confirmed}개를 확인했습니다. 원문과 단위·기준을 검토해야 오류를 확정할 수 있습니다.`,
        label: '핵심 확인 항목으로 이동',
        run: () => inspect(progress.pending),
      };
    if (pendingResult?.status === '확인 필요')
      return {
        text: `${presentResult(pendingResult).headline}: ${presentResult(pendingResult).nextAction}`,
        label: '동일 기준·조건 확인',
        run: () => prepare(pendingResult),
      };
    if (unapproved)
      return {
        text: `${unapproved.title} — 추천 관계와 적용 기준을 검토한 뒤 승인하세요.`,
        label: unapproved.calculation ? '계산 구성 항목 확인' : '동일 항목 연결 확인',
        run: () => {
          setStep('results');
          setRecommendationFocus({
            id: unapproved.id,
            kind: unapproved.kind,
            request: crypto.randomUUID(),
          });
        },
      };
    if (pendingResult)
      return {
        text: `${presentResult(pendingResult).headline}: ${presentResult(pendingResult).nextAction}`,
        label: '필요한 조건 확인',
        run: () => prepare(pendingResult),
      };
    return {
      text: results.length
        ? '현재 구성한 검증의 판정 결과를 확인하세요. 추가 항목의 정상 여부를 뜻하지 않습니다.'
        : '검증 후보를 자동으로 찾지 못했습니다. 원본을 검토하고 항목과 검증 구성을 추가하세요.',
      label: results.length ? '결과 확인' : '항목 확인·추가',
      run: () => (results.length ? setStep('results') : inspect([])),
    };
  }
  const next = nextAction();
  function inspect(ids: string[]) {
    setFocusIds(ids);
    setStep('review');
  }
  function apply(r: Recommendation, approve: boolean) {
    revision.current++;
    setInlineDecisions((prev) => removeDecisions(prev, r.candidateIds));
    const next = applyRecommendation({ ...review, calculations }, r, approve);
    setReview({ items: next.items, links: next.links });
    setCalculations(next.calculations);
    if (approve) setApprovalVersion((v) => v + 1);
  }
  /** 판정에 사용한 항목과 일치하는 추천 또는 구조화 확인 화면으로 안내한다. */
  function prepare(result: Result) {
    setStep('results');
    setAdvancedOpen(true);
    const exact = recommendations.find(
      (r) =>
        (r.calculation && `calc:${r.calculation.id}` === result.id) ||
        (r.link && result.evidence.some((c) => c.id === r.link!.xlsxId) && result.evidence.some((c) => c.id === r.link!.docxId)),
    );
    const kind = result.code.startsWith('CALC')
      ? 'CALC'
      : result.code.startsWith('CROSS')
        ? 'CROSS'
        : result.code.startsWith('ALLOC')
          ? 'ALLOC'
          : 'PLAN';
    const candidate =
      exact ??
      recommendations.find(
        (r) =>
          r.kind === kind &&
          (r.calculation
            ? result.code === `CALC_${r.calculation.rule.toUpperCase()}`
            : r.references.some((ref) =>
                result.references?.some((x) => x.source === ref.source && x.fileName === ref.fileName && x.location === ref.location),
              )),
      ) ??
      recommendations.find((r) => r.kind === kind);
    if (candidate?.planFocus) {
      openPlan(candidate);
      return;
    }
    if (!candidate && kind === 'CALC') {
      setCalculationFocus({
        id: result.id.replace(/^calc:/, ''),
        request: crypto.randomUUID(),
      });
      return;
    }
    setRecommendationFocus({
      id: candidate?.id ?? '',
      kind,
      request: crypto.randomUUID(),
    });
  }
  function openPlan(r: Recommendation) {
    setStep('results');
    setAdvancedOpen(true);
    revision.current++;
    let focus = r.planFocus;
    if (!focus) {
      const row = r.allocation ?? newRecord('allocation', crypto.randomUUID());
      setPlanning((prev) => (prev.allocations.some((a) => a.id === row.id) ? prev : { ...prev, allocations: [row, ...prev.allocations] }));
      focus = { kind: 'allocations', id: row.id };
    }
    setPlanFocus({ ...focus, request: crypto.randomUUID() });
  }
  function replaceSource(source: Candidate['source'], next: Candidate[], references: EvidenceRef[] = [], fingerprint?: string) {
    revision.current++;
    inspectionRun.current.generation++;
    setInspectionStatus('ready');
    setAdvancedOpen(false);
    setInlineDecisions({});
    setDocuments((prev) => {
      const nextDocs = { ...prev };
      if (fingerprint !== undefined || next.length || references.length) nextDocs[source] = fingerprint ?? '';
      else delete nextDocs[source];
      return nextDocs;
    });
    const replaced = new Set(review.items.filter((c) => c.source === source).map((c) => c.id));
    setSourceReferences((prev) => [...prev.filter((r) => r.source !== source), ...references]);
    setPlanning((prev) => replacePlanningSource(prev, source, replaced, references));
    setCalculations((prev) =>
      prev.map((s) => ({
        ...s,
        targetId: replaced.has(s.targetId) ? '' : s.targetId,
        groups: Object.fromEntries(Object.entries(s.groups).map(([key, ids]) => [key, ids.filter((id) => !replaced.has(id))])),
        scopeConfirmed: false,
      })),
    );
    setReview((prev) => ({
      items: [...prev.items.filter((c) => c.source !== source), ...next],
      links: removeLinks(prev.links, new Set(prev.items.filter((c) => c.source === source).map((c) => c.id))),
    }));
  }
  function edit(id: string, patch: Partial<Candidate>) {
    revision.current++;
    setInlineDecisions((prev) => removeDecisions(prev, [id]));
    setPlanning((prev) => ({
      ...prev,
      allocations: prev.allocations.map((r) =>
        r.assetId === id || r.goalId === id || r.candidateIds.includes(id) ? { ...r, confirmed: false } : r,
      ),
      funds: prev.funds.map((r) => (r.candidateIds.includes(id) ? { ...r, confirmed: false } : r)),
      actions: prev.actions.map((r) => (r.candidateIds.includes(id) ? { ...r, confirmed: false } : r)),
    }));
    setCalculations((prev) =>
      prev.map((s) => (s.targetId === id || Object.values(s.groups).flat().includes(id) ? { ...s, scopeConfirmed: false } : s)),
    );
    setReview((prev) => ({
      items: prev.items.map((c) => (c.id === id ? editCandidate(c, patch) : c)),
      links: removeLinks(prev.links, new Set([id])),
    }));
  }
  function add() {
    revision.current++;
    const item: Candidate = {
      id: crypto.randomUUID(),
      source: 'XLSX',
      fileName: '직접 입력',
      location: '직접 입력',
      originalText: '',
      originalNumber: null,
      label: '새 항목',
      number: '',
      unit: '미확인',
      normalizedValue: null,
      field: 'unknown',
      asOf: '',
      period: '',
      scenario: '',
      certainty: '미확인',
      confirmed: false,
      excluded: false,
      method: '직접 입력',
      confidence: '확인 필요',
      note: '원본 문맥을 확인하고 필요한 정보를 입력하세요.',
    };
    setReview((prev) => ({ ...prev, items: [item, ...prev.items] }));
  }
  function link(a: string, b: string) {
    revision.current++;
    setInlineDecisions((prev) => removeDecisions(prev, [a, b]));
    setReview((prev) => {
      const x = prev.items.find((c) => c.id === a && !c.excluded && c.source === 'XLSX'),
        y = prev.items.find((c) => c.id === b && !c.excluded && c.source === 'DOCX');
      if (!x || !y || x.field !== y.field || assessRelationship(x, y).blocked || prev.links.some((l) => l.xlsxId === a && l.docxId === b))
        return prev;
      return {
        ...prev,
        links: [...prev.links, { id: crypto.randomUUID(), xlsxId: a, docxId: b }],
      };
    });
  }
  function unlink(id: string) {
    revision.current++;
    const pair = review.links.find((l) => l.id === id);
    if (pair) setInlineDecisions((prev) => removeDecisions(prev, [pair.xlsxId, pair.docxId]));
    setReview((prev) => ({
      ...prev,
      links: prev.links.filter((l) => l.id !== id),
    }));
  }
  function confirm(id: string) {
    revision.current++;
    setReview((prev) => ({
      ...prev,
      items: prev.items.map((c) => (c.id === id && canConfirm(c) ? { ...c, confirmed: true } : c)),
    }));
  }
  /** 원본을 임의 확정하지 않고 명시적 답변으로 기존 승인 상태를 갱신한다. */
  function inlineReview(r: Recommendation, choice: ReviewChoice, answers: InlineAnswers) {
    const outcome = applyInlineReview({ ...review, calculations }, r, choice, answers);
    if (!outcome.ok) return outcome.issues;
    revision.current++;
    setReview({ items: outcome.state.items, links: outcome.state.links });
    setCalculations(outcome.state.calculations);
    setInlineDecisions((prev) => ({
      ...removeDecisions(prev, outcome.changedIds),
      [r.id]: outcome.decision,
    }));
    if (outcome.changedIds.length)
      setPlanning((prev) => ({
        ...prev,
        allocations: prev.allocations.map((row) =>
          outcome.changedIds.some((id) => row.assetId === id || row.goalId === id || row.candidateIds.includes(id))
            ? { ...row, confirmed: false }
            : row,
        ),
        funds: prev.funds.map((row) =>
          row.candidateIds.some((id) => outcome.changedIds.includes(id)) ? { ...row, confirmed: false } : row,
        ),
        actions: prev.actions.map((row) =>
          row.candidateIds.some((id) => outcome.changedIds.includes(id)) ? { ...row, confirmed: false } : row,
        ),
      }));
    setApprovalVersion((v) => v + 1);
    return [];
  }
  return (
    <>
      <header>
        <div className="brand">
          <FileCheck2 aria-hidden />
          <strong>PlanCheck</strong>
          <span>재무 문서 검사기</span>
        </div>
      </header>
      <main>
        <div className="intro">
          <h1>{step === 'raw' ? '재무설계 문서 검사' : step === 'review' ? '상세 검토' : '검사 결과'}</h1>
          <p>Excel 재무표와 Word 보고서를 대조해 숫자 차이와 계획의 확인 지점을 찾습니다.</p>
        </div>
        <nav className="steps" aria-label="작업 단계">
          <Button
            variant={step === 'raw' ? 'default' : 'outline'}
            aria-pressed={step === 'raw'}
            aria-current={step === 'raw' ? 'step' : undefined}
            onClick={() => setStep('raw')}
          >
            1. 검사 시작
          </Button>
          <Button
            variant={step === 'results' ? 'default' : 'outline'}
            aria-pressed={step === 'results'}
            aria-current={step === 'results' ? 'step' : undefined}
            onClick={() => setStep('results')}
          >
            2. 검사 결과
          </Button>
          <Button
            variant={step === 'review' ? 'default' : 'outline'}
            aria-pressed={step === 'review'}
            aria-current={step === 'review' ? 'step' : undefined}
            onClick={() => {
              setFocusIds([]);
              setStep('review');
            }}
          >
            3. 상세 검토 (선택)
          </Button>
        </nav>
        <p className="muted">
          3단계 중 {step === 'raw' ? 1 : step === 'review' ? 3 : 2}단계 ·{' '}
          {step === 'raw' ? '검사 시작' : step === 'review' ? '상세 검토 (선택)' : '검사 결과'}
        </p>
        <details className="optional-help">
          <summary>상세 작업 안내</summary>
          <StepGuide step={step} open={guides[step]} onToggle={() => setGuides((prev) => ({ ...prev, [step]: !prev[step] }))} />
          <aside className="next-action" aria-label="다음 행동">
            <div>
              <strong>다음 할 일</strong>
              <p>{next.text}</p>
            </div>
            <Button onClick={next.run}>{next.label}</Button>
          </aside>
        </details>
        {step === 'raw' && (
          <div className="scope">
            <p>선택한 문서는 브라우저 안에서만 처리하며 외부로 전송하지 않습니다.</p>
            <p>Excel 수식은 재계산하지 않습니다. 최신 계산 결과를 저장한 파일을 사용하세요.</p>
          </div>
        )}
        <div className="workspace" hidden={step !== 'raw'}>
          <DocumentPanel
            compact
            extension="xlsx"
            title="Excel 재무표"
            parse={parseXlsx}
            summary={(data) => (
              <DocumentSummary data={data} items={review.items.filter((c) => c.source === 'XLSX' && c.method !== '직접 입력')} />
            )}
            onData={(data, fingerprint) => {
              setRegistered((prev) => ({ ...prev, XLSX: !!data }));
              replaceSource('XLSX', data ? extractWorkbook(data) : [], data ? workbookReferences(data) : [], fingerprint);
            }}
          >
            {(data) => <WorkbookView data={data} showSource={false} />}
          </DocumentPanel>
          <DocumentPanel
            compact
            extension="docx"
            title="Word 보고서"
            parse={parseDocx}
            summary={(data) => (
              <DocumentSummary data={data} items={review.items.filter((c) => c.source === 'DOCX' && c.method !== '직접 입력')} />
            )}
            onData={(data, fingerprint) => {
              setRegistered((prev) => ({ ...prev, DOCX: !!data }));
              replaceSource('DOCX', data ? extractWord(data) : [], data ? wordReferences(data) : [], fingerprint);
            }}
          >
            {(data) => <WordView data={data} showSource={false} />}
          </DocumentPanel>
        </div>
        {step === 'raw' && (
          <div className="inspection-start" aria-busy={inspectionStatus === 'running'}>
            <div>
              <strong>{registered.XLSX && registered.DOCX ? '두 문서가 준비됐습니다' : 'Excel과 Word 파일을 각각 등록하세요'}</strong>
              <p>계산·문서 간 수치·자금 배정·계획 후보를 자동 분석합니다. 규칙을 먼저 설정할 필요가 없습니다.</p>
              {inspectionStatus === 'running' && <p role="status">문서를 비교하고 검토할 항목을 찾고 있습니다…</p>}
            </div>
            <Button
              disabled={!registered.XLSX || !registered.DOCX || inspectionStatus === 'running'}
              onClick={() => void startInspection()}
            >
              {inspectionStatus === 'running' ? '검사 중…' : '검사 시작'}
            </Button>
          </div>
        )}
        {step === 'review' && (
          <ReviewView
            key={focusIds.join('|') || 'review'}
            coreIds={coreIds}
            reasons={recommendations
              .filter((r) => r.primary)
              .map((r) => ({
                ids: r.candidateIds,
                reason: r.reason,
                title: r.title,
              }))}
            focusIds={focusIds}
            items={review.items}
            links={review.links}
            onEdit={edit}
            onAdd={add}
            onLink={link}
            onUnlink={unlink}
            onConfirm={confirm}
          />
        )}
        {step === 'results' && (
          <>
            <InspectionResults
              onPlanReview={(finding, choice) => {
                revision.current++;
                if (finding.kind === 'CALC' && choice !== 'same')
                  setCalculations((previous) =>
                    previous.map((spec) =>
                      spec.id === finding.recommendation?.calculation?.id ? { ...spec, scopeConfirmed: false } : spec,
                    ),
                  );
                const ids = finding.result.evidence.map((c) => c.id);
                setInlineDecisions((previous) => ({
                  ...previous,
                  [finding.id]: {
                    choice,
                    candidateIds: ids,
                    fingerprint: reviewFingerprint(review.items, ids),
                    planningFingerprint: planReviewFingerprint(planning, finding.result.references ?? []),
                  },
                }));
              }}
              onInlineReview={inlineReview}
              onPrepare={prepare}
              started={inspectionStarted}
              findings={findings}
              items={review.items}
              links={review.links}
              calculations={calculations}
              planning={planning}
              references={sourceReferences}
              onEdit={edit}
              onApply={apply}
              onInspect={inspect}
              onPlan={openPlan}
              onStart={() => setStep('raw')}
            />
            <details className="advanced-workspace" open={advancedOpen} onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}>
              <summary>고급 검사 설정·승인 결과</summary>
              {!registered.XLSX && !registered.DOCX && review.items.length === 0 ? (
                <div className="empty">
                  <p>아직 검사할 문서가 없습니다. 문서를 등록하고 검사를 시작하면 결과를 표시합니다.</p>
                  <Button onClick={() => register('XLSX')}>문서 등록하기</Button>
                </div>
              ) : (
                <ResultsView
                  calculationFocus={calculationFocus}
                  onPrepare={prepare}
                  approvalVersion={approvalVersion}
                  recommendationPanel={
                    <RecommendationCenter
                      key={recommendationFocus?.request ?? 'recommendations'}
                      focus={recommendationFocus}
                      recommendations={recommendations}
                      items={review.items}
                      links={review.links}
                      calculations={calculations}
                      onEdit={edit}
                      onApply={apply}
                      onInspect={inspect}
                      onPlan={openPlan}
                    />
                  }
                  sessionPanel={
                    <SessionReview
                      getRevision={() => revision.current}
                      items={review.items}
                      links={review.links}
                      documents={documents}
                      onRestore={(next) => {
                        revision.current++;
                        setInlineDecisions({});
                        setReview(next);
                        setCalculations((prev) => prev.map((c) => ({ ...c, scopeConfirmed: false })));
                        setPlanning((prev) => ({
                          ...prev,
                          allocations: prev.allocations.map((r) => ({
                            ...r,
                            confirmed: false,
                          })),
                          funds: prev.funds.map((r) => ({
                            ...r,
                            confirmed: false,
                          })),
                          actions: prev.actions.map((r) => ({
                            ...r,
                            confirmed: false,
                          })),
                        }));
                      }}
                    />
                  }
                  planFocus={planFocus}
                  planning={planning}
                  references={sourceReferences}
                  onPlanningChange={(next) => {
                    revision.current++;
                    setPlanning(next);
                  }}
                  items={review.items}
                  links={review.links}
                  calculations={calculations}
                  onChange={(next) => {
                    revision.current++;
                    setCalculations(next);
                  }}
                  onInspect={inspect}
                />
              )}
            </details>
          </>
        )}
      </main>
      <footer>PlanCheck | 재무 문서 검사기</footer>
    </>
  );
}
