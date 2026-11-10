import { useState } from "react";
import { FileCheck2, LockKeyhole } from "lucide-react";
import { DocumentPanel } from "./components/DocumentPanel";
import { WorkbookView } from "./components/WorkbookView";
import { WordView } from "./components/WordView";
import { ReviewView } from "./components/ReviewView";
import { ResultsView } from "./components/ResultsView";
import { newCalculation, ruleTitles } from "./validation/types";
import type { Calculation, Rule } from "./validation/types";
import { Button } from "./components/ui/button";
import { parseXlsx } from "./parsers/xlsx";
import { parseDocx } from "./parsers/docx";
import { extractWorkbook, extractWord } from "./normalization/extract";
import { editCandidate, canConfirm } from "./normalization/values";
import { removeLinks } from "./normalization/links";
import type { Candidate, Link } from "./normalization/types";
/** 원본 추출과 사용자 확인 상태를 관리하며 파일 교체 시 관련 연결을 해제한다. */
export default function App() {
  const [step, setStep] = useState<"raw" | "review" | "results">("raw");
  const [focusIds, setFocusIds] = useState<string[]>([]);
  const [calculations, setCalculations] = useState<Calculation[]>(() =>
    Object.keys(ruleTitles).map((rule) => newCalculation(rule as Rule, rule)),
  );
  const [review, setReview] = useState<{ items: Candidate[]; links: Link[] }>({
    items: [],
    links: [],
  });
  function replaceSource(source: Candidate["source"], next: Candidate[]) {
    const replaced = new Set(
      review.items.filter((c) => c.source === source).map((c) => c.id),
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
        <div className="workspace" hidden={step !== "raw"}>
          <DocumentPanel
            extension="xlsx"
            title="Excel 재무표"
            parse={parseXlsx}
            onData={(data) =>
              replaceSource("XLSX", data ? extractWorkbook(data) : [])
            }
          >
            {(data) => <WorkbookView data={data} />}
          </DocumentPanel>
          <DocumentPanel
            extension="docx"
            title="Word 보고서"
            parse={parseDocx}
            onData={(data) =>
              replaceSource("DOCX", data ? extractWord(data) : [])
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
            onUnlink={(id) =>
              setReview((prev) => ({
                ...prev,
                links: prev.links.filter((l) => l.id !== id),
              }))
            }
            onConfirm={(id) =>
              setReview((prev) => ({
                ...prev,
                items: prev.items.map((c) =>
                  c.id === id && canConfirm(c) ? { ...c, confirmed: true } : c,
                ),
              }))
            }
          />
        )}
        {step === "results" && (
          <ResultsView
            items={review.items}
            links={review.links}
            calculations={calculations}
            onChange={setCalculations}
            onInspect={(ids) => {
              setFocusIds(ids);
              setStep("review");
            }}
          />
        )}
      </main>
      <footer>PlanCheck · 문서 추출 및 데이터 확인</footer>
    </>
  );
}
