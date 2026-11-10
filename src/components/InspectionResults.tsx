import { useState, useRef, useEffect } from "react";
import type { InspectionInput } from "../inspection/analyze";
import type { Recommendation } from "../recommendations/types";
import type { Candidate } from "../normalization/types";
import type { Result } from "../validation/types";
import type { ReviewChoice, InlineAnswers } from "../inspection/review";
import {
  groupFindings,
  findingSection,
  resultSections,
  type ReviewedFinding,
} from "../presentation/findingGroups";
import { formatFinancial } from "../presentation/format";
import { candidateValue } from "../presentation/workflow";
import { RecommendationDetail } from "./RecommendationCenter";
import { InlineReview } from "./InlineReview";
import { Button } from "./ui/button";
const kinds = {
  CALC: "계산",
  CROSS: "문서 간 비교",
  ALLOC: "자금 배정",
  PLAN: "조건부 금액·계획",
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
  onInlineReview: (
    r: Recommendation,
    choice: ReviewChoice,
    answers: InlineAnswers,
  ) => string[];
};
function explanation(f: ReviewedFinding) {
  if (f.decision?.choice === "different")
    return "다른 조건의 값으로 분류했습니다. 원래 수치 차이는 유지하며 확정 오류로 비교하지 않습니다.";
  if (f.decision?.choice === "unknown")
    return "원본 조건을 확인할 수 없어 보류했습니다. 원래 수치 차이와 근거는 유지합니다.";
  if (f.approved?.status === "오류")
    return "사용자가 확인한 관계와 적용 조건에서 차이가 검출됐습니다. 원본을 대조해 수정할 내용을 확인하세요.";
  if (f.approved?.status === "검증 통과")
    return "확인한 항목과 검사 범위에서 통과했습니다. 다른 범위의 정상 여부까지 뜻하지 않습니다.";
  if ((f.approved ?? f.result).status === "검증 불가")
    return "검사에 필요한 값이나 관계가 부족합니다. 근거에서 누락 조건을 확인하세요.";
  return f.kind === "CROSS"
    ? f.signal === "수치 차이"
      ? "두 문서에 다른 수치가 있습니다. 동일한 대상과 기준의 값인지 확인해 주세요."
      : "숫자만으로 동일 항목을 확정하지 않습니다. 관계와 적용 기준을 확인해 주세요."
    : "추천된 구성과 원문 조건을 바탕으로 한 후보입니다. 필요한 범위와 조건을 확인해 주세요.";
}
/** 결과를 네 영역으로 나누고 공유 원본 후보를 모두 보존하며 해당 행에서 검토한다. */
export function InspectionResults(props: Props) {
  const { findings, started, onInspect } = props;
  const [kind, setKind] = useState("전체"),
    [expandRelated, setExpandRelated] = useState(false),
    [selected, setSelected] = useState(""),
    [complex, setComplex] = useState(false);
  const detailRef = useRef<HTMLElement>(null),
    rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected) {
      detailRef.current?.scrollIntoView?.({ block: "nearest" });
      detailRef.current?.focus();
    }
  }, [selected]);
  const filtered = findings.filter((f) => kind === "전체" || f.kind === kind),
    sections = groupFindings(filtered);
  function close(id: string) {
    setSelected("");
    requestAnimationFrame(() =>
      Array.from(
        rootRef.current?.querySelectorAll<HTMLElement>(".finding") ?? [],
      )
        .find((el) => el.dataset.finding === id)
        ?.focus(),
    );
  }
  function card(f: ReviewedFinding) {
    const r = f.approved ?? f.result,
      section = findingSection(f);
    const status =
      f.decision?.choice === "different"
        ? "다른 조건 · 보류"
        : f.decision?.choice === "unknown"
          ? "확인 불가 · 보류"
          : f.approved
            ? `사용자 확인 후 · ${f.approved.status}`
            : section === resultSections[3]
              ? "정보 부족 · 보류"
              : "자동 발견 · 확인 필요";
    return (
      <article className="finding" data-finding={f.id} key={f.id} tabIndex={-1}>
        <div className="finding-heading">
          <h3>
            {!f.approved && f.kind === "PLAN"
              ? `${r.title.replace(/^(조건부 금액|제안·실행 비교|대응 계획 필요) · /, "")} — ${f.title}`
              : f.title}
          </h3>
          <span
            className={
              section === resultSections[0]
                ? "result-error"
                : section === resultSections[2]
                  ? "result-pass"
                  : section === resultSections[3]
                    ? "result-unavailable"
                    : "result-review"
            }
          >
            {status}
          </span>
        </div>
        <div className="finding-values">
          {r.evidence.slice(0, f.kind === "CROSS" ? 2 : 4).map((c) => (
            <p key={c.id}>
              <span>
                {c.source === "XLSX" ? "Excel" : "Word"} · {c.label}
              </span>
              <strong>{candidateValue(c)}</strong>
            </p>
          ))}
        </div>
        {!r.evidence.length && (
          <p className="finding-comparison">
            {r.references?.[0]?.source === "XLSX" ? "Excel" : "Word"} ·{" "}
            {r.actual === null
              ? "금액·관계 미확인"
              : `원문 금액 후보 ${formatFinancial(r.actual, r.unit)}`}
          </p>
        )}
        {r.difference !== null && (
          <p className="finding-comparison">
            {f.kind === "CROSS" ? "두 값의 차이" : "문서값과 계산값 차이"}:{" "}
            <strong>
              {formatFinancial(
                Math.abs(r.difference),
                r.unit === "%" ? "%p" : r.unit,
                { difference: true },
              )}
            </strong>
            {f.kind === "CALC" && (
              <> · 재계산 {formatFinancial(r.expected, r.unit)}</>
            )}
          </p>
        )}
        <p className="finding-description">{explanation(f)}</p>
        <div className="finding-actions">
          <Button
            onClick={() => {
              if (f.recommendation) {
                setSelected(f.id);
                setComplex(!f.recommendation.link);
              } else props.onPrepare(r);
            }}
          >
            {f.approved ? "확인 내용 수정" : "이 항목 검토"}
          </Button>
        </div>
        {selected === f.id && f.recommendation && (
          <section
            ref={detailRef}
            tabIndex={-1}
            className="focused-review"
            aria-label="선택 항목 상세 검토"
          >
            {!complex && f.recommendation.link ? (
              <InlineReview
                key={f.id}
                finding={f}
                items={props.items}
                onApply={(choice, answers) => {
                  const issues = props.onInlineReview(
                    f.recommendation!,
                    choice,
                    answers,
                  );
                  if (!issues.length) close(f.id);
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
                  recommendation={f.recommendation}
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
        <details className="finding-proof">
          <summary>판단 근거 보기</summary>
          <p className="pre">{r.basis}</p>
          {r.evidence.map((c) => (
            <div className="finding-evidence" key={c.id}>
              <strong>
                {c.source} · {c.fileName} · {c.location}
              </strong>
              <p className="pre">{c.originalText || "직접 입력"}</p>
              <small>
                기준일 {c.asOf || "미확인"} · 시나리오 {c.scenario || "미확인"}{" "}
                · 적용 기간 {c.period || "미확인"} · {c.certainty}
                <br />
                추출: {c.method} · {c.confidence} ·{" "}
                {c.confirmed ? "사용자 확인됨" : "사용자 미확인"}
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
              연결 근거: {f.recommendation.reason} ·{" "}
              {f.recommendation.confidence}
            </p>
          )}
          <small>검증 규칙 {r.code}</small>
          <div className="finding-actions">
            <Button
              variant="outline"
              disabled={!r.evidence.length}
              onClick={() => onInspect(r.evidence.map((c) => c.id))}
            >
              관련 원본·데이터 수정
            </Button>
          </div>
        </details>
      </article>
    );
  }
  if (!started)
    return (
      <section className="inspection-results empty" aria-label="자동 검사 결과">
        <h2>두 문서를 등록하고 검사를 시작하세요</h2>
        <p>
          항목이나 검사 규칙을 먼저 설정할 필요가 없습니다. 문서가 바뀌면 다시
          검사해야 합니다.
        </p>
        <Button onClick={props.onStart}>검사 시작 화면으로</Button>
      </section>
    );
  return (
    <section
      ref={rootRef}
      className="inspection-results"
      aria-label="자동 검사 결과"
    >
      <div className="inspection-heading">
        <h2>검사 결과</h2>
        <span>자동 발견과 사용자 확인 후 판정을 구분합니다</span>
      </div>
      <div className="inspection-counts">
        <strong>
          확정 오류{" "}
          {
            findings.filter((f) => findingSection(f) === resultSections[0])
              .length
          }
        </strong>
        <span>
          수치 불일치 및 확인 필요{" "}
          {
            findings.filter((f) => findingSection(f) === resultSections[1])
              .length
          }
        </span>
        <span>
          검증 통과{" "}
          {
            findings.filter((f) => findingSection(f) === resultSections[2])
              .length
          }
        </span>
        <span>
          정보 부족·조건 보류{" "}
          {
            findings.filter((f) => findingSection(f) === resultSections[3])
              .length
          }
        </span>
      </div>
      <p className="inspection-coverage">
        자동 발견은 승인이 아닙니다. 모든 후보를 보존하며 같은 원본을 공유하는
        결과는 추가 후보로 묶습니다. 정보 부족은 검사 실패나 정상 판정이
        아닙니다.
      </p>
      <div className="inspection-filters">
        <label>
          오류 유형
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="전체">전체 유형</option>
            {Object.entries(kinds).map(([key, label]) => (
              <option key={key} value={key}>
                {label} ({findings.filter((f) => f.kind === key).length})
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={expandRelated}
            onChange={(e) => setExpandRelated(e.target.checked)}
          />
          같은 원본의 추가 후보 모두 펼치기
        </label>
        <span>
          {filtered.length}개 결과 ·{" "}
          {sections.reduce((n, s) => n + s.groups.length, 0)}개 묶음
        </span>
      </div>
      {sections.map(({ section, count, groups }) => (
        <section key={section} className="finding-section" aria-label={section}>
          <h2>
            {section} <span>{count}건</span>
          </h2>
          {!count && (
            <p className="section-empty">이 영역에 표시할 결과가 없습니다.</p>
          )}
          {groups.map((group) => (
            <div
              className="finding-group"
              key={group.map((f) => f.id).join("|")}
            >
              {card(group[0])}
              {group.length > 1 && (
                <details className="related-findings" open={expandRelated}>
                  <summary>
                    같은 원본을 사용하는 추가 후보 {group.length - 1}건 · 개별
                    근거 유지
                  </summary>
                  {group.slice(1).map(card)}
                </details>
              )}
            </div>
          ))}
        </section>
      ))}
    </section>
  );
}
