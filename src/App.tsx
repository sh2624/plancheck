import { useState, useMemo, useRef } from "react";
import { FileCheck2, LockKeyhole } from "lucide-react";
import { DocumentPanel } from "./components/DocumentPanel";
import { WorkbookView } from "./components/WorkbookView";
import { WordView } from "./components/WordView";
import { ReviewView } from "./components/ReviewView";
import { ResultsView } from "./components/ResultsView";
import { newCalculation, ruleTitles } from "./validation/types";
import type { Calculation, Rule, Result } from "./validation/types";
import { Button } from "./components/ui/button";
import { parseXlsx } from "./parsers/xlsx";
import { parseDocx } from "./parsers/docx";
import { extractWorkbook, extractWord } from "./normalization/extract";
import { editCandidate, canConfirm } from "./normalization/values";
import { removeLinks } from "./normalization/links";
import type { Candidate, Link } from "./normalization/types";
import type { EvidenceRef } from "./validation/types";
import { emptyPlanning } from "./planning/types";
import {
  workbookReferences,
  wordReferences,
  replacePlanningSource,
} from "./planning/extract";
import { newRecord } from "./planning/types";
import { recommend } from "./recommendations/recommend";
import { applyRecommendation } from "./recommendations/apply";
import type { Recommendation } from "./recommendations/types";
import { RecommendationCenter } from "./components/RecommendationCenter";
import { SessionReview } from "./components/SessionReview";
import type { Documents } from "./session/checkpoint";
/** 원본 추출과 사용자 확인 상태를 관리하며 파일 교체 시 관련 연결을 해제한다. */
export default function App() {
  const revision = useRef(0);
  const [step, setStep] = useState<"raw" | "review" | "results">("raw");
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
  const [planFocus, setPlanFocus] = useState<{
    kind: "allocations" | "funds" | "actions";
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
  function inspect(ids: string[]) {
    setFocusIds(ids);
    setStep("review");
  }
  function apply(r: Recommendation, approve: boolean) {
    revision.current++;
    const next = applyRecommendation({ ...review, calculations }, r, approve);
    setReview({ items: next.items, links: next.links });
    setCalculations(next.calculations);
    if (approve) setApprovalVersion((v) => v + 1);
  }
  /** 판정에 사용한 항목과 일치하는 추천 또는 구조화 확인 화면으로 안내한다. */
  function prepare(result: Result) {
    const exact = recommendations.find(
      (r) =>
        (r.calculation && `calc:${r.calculation.id}` === result.id) ||
        (r.link &&
          result.evidence.some((c) => c.id === r.link!.xlsxId) &&
          result.evidence.some((c) => c.id === r.link!.docxId)),
    );
    const kind = result.code.startsWith("CALC")
      ? "CALC"
      : result.code.startsWith("CROSS")
        ? "CROSS"
        : result.code.startsWith("ALLOC")
          ? "ALLOC"
          : "PLAN";
    const candidate =
      exact ??
      recommendations.find(
        (r) =>
          r.kind === kind &&
          (r.calculation
            ? result.code === `CALC_${r.calculation.rule.toUpperCase()}`
            : r.references.some((ref) =>
                result.references?.some(
                  (x) =>
                    x.source === ref.source &&
                    x.fileName === ref.fileName &&
                    x.location === ref.location,
                ),
              )),
      ) ??
      recommendations.find((r) => r.kind === kind);
    if (candidate?.planFocus) {
      openPlan(candidate);
      return;
    }
    setRecommendationFocus({
      id: candidate?.id ?? "",
      kind,
      request: crypto.randomUUID(),
    });
  }
  function openPlan(r: Recommendation) {
    revision.current++;
    let focus = r.planFocus;
    if (!focus) {
      const row = r.allocation ?? newRecord("allocation", crypto.randomUUID());
      setPlanning((prev) =>
        prev.allocations.some((a) => a.id === row.id)
          ? prev
          : { ...prev, allocations: [row, ...prev.allocations] },
      );
      focus = { kind: "allocations", id: row.id };
    }
    setPlanFocus({ ...focus, request: crypto.randomUUID() });
  }
  function replaceSource(
    source: Candidate["source"],
    next: Candidate[],
    references: EvidenceRef[] = [],
    fingerprint?: string,
  ) {
    revision.current++;
    setDocuments((prev) => {
      const nextDocs = { ...prev };
      if (fingerprint !== undefined || next.length || references.length)
        nextDocs[source] = fingerprint ?? "";
      else delete nextDocs[source];
      return nextDocs;
    });
    const replaced = new Set(
      review.items.filter((c) => c.source === source).map((c) => c.id),
    );
    setSourceReferences((prev) => [
      ...prev.filter((r) => r.source !== source),
      ...references,
    ]);
    setPlanning((prev) =>
      replacePlanningSource(prev, source, replaced, references),
    );
    setCalculations((prev) =>
      prev.map((s) => ({
        ...s,
        targetId: replaced.has(s.targetId) ? "" : s.targetId,
        groups: Object.fromEntries(
          Object.entries(s.groups).map(([key, ids]) => [
            key,
            ids.filter((id) => !replaced.has(id)),
          ]),
        ),
        scopeConfirmed: false,
      })),
    );
    setReview((prev) => ({
      items: [...prev.items.filter((c) => c.source !== source), ...next],
      links: removeLinks(
        prev.links,
        new Set(prev.items.filter((c) => c.source === source).map((c) => c.id)),
      ),
    }));
  }
  function edit(id: string, patch: Partial<Candidate>) {
    revision.current++;
    setPlanning((prev) => ({
      ...prev,
      allocations: prev.allocations.map((r) =>
        r.assetId === id || r.goalId === id || r.candidateIds.includes(id)
          ? { ...r, confirmed: false }
          : r,
      ),
      funds: prev.funds.map((r) =>
        r.candidateIds.includes(id) ? { ...r, confirmed: false } : r,
      ),
      actions: prev.actions.map((r) =>
        r.candidateIds.includes(id) ? { ...r, confirmed: false } : r,
      ),
    }));
    setCalculations((prev) =>
      prev.map((s) =>
        s.targetId === id || Object.values(s.groups).flat().includes(id)
          ? { ...s, scopeConfirmed: false }
          : s,
      ),
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
      source: "XLSX",
      fileName: "직접 입력",
      location: "직접 입력",
      originalText: "",
      originalNumber: null,
      label: "새 항목",
      number: "",
      unit: "미확인",
      normalizedValue: null,
      field: "unknown",
      asOf: "",
      period: "",
      scenario: "",
      certainty: "미확인",
      confirmed: false,
      excluded: false,
      method: "직접 입력",
      confidence: "확인 필요",
      note: "원본 문맥을 확인하고 필요한 정보를 입력하세요.",
    };
    setReview((prev) => ({ ...prev, items: [item, ...prev.items] }));
  }
  function link(a: string, b: string) {
    revision.current++;
    setReview((prev) => {
      const x = prev.items.find(
          (c) => c.id === a && !c.excluded && c.source === "XLSX",
        ),
        y = prev.items.find(
          (c) => c.id === b && !c.excluded && c.source === "DOCX",
        );
      if (!x || !y || prev.links.some((l) => l.xlsxId === a && l.docxId === b))
        return prev;
      return {
        ...prev,
        links: [
          ...prev.links,
          { id: crypto.randomUUID(), xlsxId: a, docxId: b },
        ],
      };
    });
  }
  function unlink(id: string) {
    revision.current++;
    setReview((prev) => ({
      ...prev,
      links: prev.links.filter((l) => l.id !== id),
    }));
  }
  function confirm(id: string) {
    revision.current++;
    setReview((prev) => ({
      ...prev,
      items: prev.items.map((c) =>
        c.id === id && canConfirm(c) ? { ...c, confirmed: true } : c,
      ),
    }));
  }
  return (
    <>
      <header>
        <div className="brand">
          <FileCheck2 aria-hidden />
          <strong>PlanCheck</strong>
          <span>문서 검수 작업 공간</span>
        </div>
        <span className="privacy">
          <LockKeyhole size={14} aria-hidden />
          브라우저 내 처리
        </span>
      </header>
      <main>
        <div className="intro">
          <h1>
            {step === "raw"
              ? "문서 추출"
              : step === "review"
                ? "데이터 확인"
                : "검수 결과"}
          </h1>
          <p>문서에서 재무 항목 후보를 찾고 단위와 적용 범위를 확인합니다.</p>
        </div>
        <nav className="steps" aria-label="작업 단계">
          <Button
            variant={step === "raw" ? "default" : "outline"}
            aria-pressed={step === "raw"}
            onClick={() => setStep("raw")}
          >
            1. 원본 추출
          </Button>
          <Button
            variant={step === "review" ? "default" : "outline"}
            aria-pressed={step === "review"}
            onClick={() => {
              setFocusIds([]);
              setStep("review");
            }}
          >
            2. 데이터 확인 ({review.items.filter((c) => !c.excluded).length})
          </Button>
          <Button
            variant={step === "results" ? "default" : "outline"}
            aria-pressed={step === "results"}
            onClick={() => setStep("results")}
          >
            3. 검수 결과
          </Button>
        </nav>
        <div className="scope">
          파일은 외부 서버로 전송하지 않습니다. 추출 후보와 문서 간 연결은
          사용자 확인 대상입니다. 확인된 값과 선택한 계산 범위·승인 연결에
          한정해 검증합니다.
        </div>
        {step === "raw" && review.items.length > 0 && (
          <aside className="upload-next">
            <span>
              전체 항목을 확인할 필요 없이 핵심 추천부터 검토할 수 있습니다.
            </span>
            <Button onClick={() => setStep("results")}>
              핵심 추천 {recommendations.filter((r) => r.primary).length}건 검토
            </Button>
          </aside>
        )}
        <div className="workspace" hidden={step !== "raw"}>
          <DocumentPanel
            extension="xlsx"
            title="Excel 재무표"
            parse={parseXlsx}
            onData={(data, fingerprint) =>
              replaceSource(
                "XLSX",
                data ? extractWorkbook(data) : [],
                data ? workbookReferences(data) : [],
                fingerprint,
              )
            }
          >
            {(data) => <WorkbookView data={data} />}
          </DocumentPanel>
          <DocumentPanel
            extension="docx"
            title="Word 보고서"
            parse={parseDocx}
            onData={(data, fingerprint) =>
              replaceSource(
                "DOCX",
                data ? extractWord(data) : [],
                data ? wordReferences(data) : [],
                fingerprint,
              )
            }
          >
            {(data) => <WordView data={data} />}
          </DocumentPanel>
        </div>
        {step === "review" && (
          <ReviewView
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
        {step === "results" && (
          <ResultsView
            onPrepare={prepare}
            approvalVersion={approvalVersion}
            recommendationPanel={
              <RecommendationCenter
                key={recommendationFocus?.request ?? "recommendations"}
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
                  setReview(next);
                  setCalculations((prev) =>
                    prev.map((c) => ({ ...c, scopeConfirmed: false })),
                  );
                  setPlanning((prev) => ({
                    ...prev,
                    allocations: prev.allocations.map((r) => ({
                      ...r,
                      confirmed: false,
                    })),
                    funds: prev.funds.map((r) => ({ ...r, confirmed: false })),
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
      </main>
      <footer>PlanCheck · 재무 문서 검수</footer>
    </>
  );
}
