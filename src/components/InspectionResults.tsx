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
import {
  reviewQuality,
  filterQuality,
  contextMismatch,
  qualityTiers,
} from "../inspection/quality";
import { fieldLabels } from "../normalization/types";
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
/** 독립적인 우선 발견을 먼저 보여주고 추가·파생·보류 기록도 근거별로 유지한다. */
export function InspectionResults(props: Props) {
  const { findings, started, onInspect } = props;
  const [kind, setKind] = useState("전체"),
    [expandRelated, setExpandRelated] = useState(false),
    [selected, setSelected] = useState(""),
    [complex, setComplex] = useState(false),
    [field, setField] = useState("전체"),
    [showAdditional, setShowAdditional] = useState(false),
    [showRecords, setShowRecords] = useState(false),
    [followId, setFollowId] = useState("");
  const detailRef = useRef<HTMLElement>(null),
    rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected) {
      detailRef.current?.scrollIntoView?.({ block: "nearest" });
      detailRef.current?.focus();
    }
  }, [selected]);
  const quality = reviewQuality(findings),
    filtered = filterQuality(quality, field, kind),
    qualityMap = new Map(quality.map((e) => [e.finding.id, e])),
    followTier = quality.find((e) =>
      e.occurrences.some((f) => f.id === followId),
    )?.tier;
  const tierEntries = (tier: string) => filtered.filter((e) => e.tier === tier);
  const fields: string[] = [
    ...new Set<string>(
      quality.map((e) => e.finding.result.evidence[0]?.field ?? "planning"),
    ),
  ];
  function close(id: string) {
    setSelected("");
    setFollowId(id);
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
      section = findingSection(f),
      entry = qualityMap.get(f.id)!;
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
      <article
        className="finding"
        data-finding={f.id}
        data-tier={entry.tier}
        key={f.id}
        tabIndex={-1}
      >
        <div className="finding-heading">
          <h3>
            {f.relationship?.blocked
              ? "자동 연결에서 제외한 원본 기록"
              : !f.approved && contextMismatch(f)
                ? `${fieldLabels[r.evidence[0]?.field ?? "unknown"]} · 적용 기준이 다른 비교 기록`
                : !f.approved && f.kind === "PLAN"
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
        {r.difference !== null && (!contextMismatch(f) || !!f.decision) && (
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
        <p className="finding-description">
          {!f.decision &&
          !f.approved &&
          (f.relationship?.blocked || contextMismatch(f))
            ? entry.reasons[0]
            : explanation(f)}
        </p>
        {entry.supportCount > 0 && (
          <p className="finding-support">
            같은 발견을 지지하는 별도 원본 {entry.supportCount}건 · 상세 분석
            기록에서 확인할 수 있습니다.
          </p>
        )}
        <div className="finding-actions">
          <Button
            onClick={() => {
              if (f.relationship?.blocked) {
                onInspect(r.evidence.map((c) => c.id));
              } else if (f.recommendation) {
                setSelected(f.id);
                setComplex(!f.recommendation.link);
              } else props.onPrepare(r);
            }}
          >
            {f.relationship?.blocked
              ? "원본 항목 확인"
              : f.approved
                ? "확인 내용 수정"
                : "이 항목 검토"}
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
          <p>
            검토 분류: {entry.tier} · {entry.reasons.join(" ")}
          </p>
          {entry.occurrences.length > 1 && (
            <p>
              같은 원본 쌍·관계·근거의 완전 중복 {entry.occurrences.length}건을
              합쳤습니다. 기록 ID:{" "}
              {entry.occurrences.map((f) => f.id).join(", ")}
            </p>
          )}
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
  function grouped(tier: string) {
    const entries = tierEntries(tier),
      groups = groupFindings(entries.map((e) => e.finding)).flatMap(
        (s) => s.groups,
      );
    if (!entries.length)
      return <p className="section-empty">이 범위에 표시할 결과가 없습니다.</p>;
    return groups.map((group) => (
      <div className="finding-group" key={group.map((f) => f.id).join("|")}>
        {card(group[0])}
        {group.length > 1 && (
          <details
            className="related-findings"
            open={
              expandRelated || group.slice(1).some((f) => f.id === followId)
            }
          >
            <summary>
              공유 원본의 추가 기록 {group.length - 1}건 · 개별 근거 유지
            </summary>
            {group.slice(1).map(card)}
          </details>
        )}
      </div>
    ));
  }
  return (
    <section
      ref={rootRef}
      className="inspection-results"
      aria-label="자동 검사 결과"
    >
      <div className="inspection-heading">
        <h2>검사 결과</h2>
        <span>자동 발견과 확정 오류를 구분합니다</span>
      </div>
      <div className="inspection-counts">
        <strong>
          확정 오류{" "}
          {quality.filter((e) => e.finding.approved?.status === "오류").length}
        </strong>
        <span>
          우선 검토 {quality.filter((e) => e.tier === qualityTiers[0]).length}개
        </span>
        <span>
          자동 수치 차이 후보{" "}
          {
            quality.filter(
              (e) =>
                !e.finding.approved &&
                e.finding.signal === "수치 차이" &&
                !e.finding.relationship?.blocked &&
                !contextMismatch(e.finding),
            ).length
          }
          건 <small>반복 원본 포함</small>
        </span>
      </div>
      <div className="inspection-filters">
        <label>
          재무 항목
          <select
            aria-label="재무 항목"
            value={field}
            onChange={(e) => {
              setField(e.target.value);
              setFollowId("");
            }}
          >
            <option value="전체">전체 항목</option>
            {fields.map((key) => (
              <option key={key} value={key}>
                {key === "planning"
                  ? "계획·조건부 금액"
                  : fieldLabels[key as keyof typeof fieldLabels]}
              </option>
            ))}
          </select>
        </label>
        <details className="quality-filter-options">
          <summary>추가 필터</summary>
          <label>
            오류 유형
            <select
              aria-label="오류 유형"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="전체">전체 유형</option>
              {Object.entries(kinds).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
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
            공유 원본 기록 모두 펼치기
          </label>
        </details>
        <span>
          {filtered.length}개 분석 기록 · 전체 {quality.length}개
          {findings.length > quality.length &&
            ` · 완전 중복 ${findings.length - quality.length}건 합침`}
        </span>
      </div>
      <section
        className="finding-section quality-priority"
        aria-label="우선 검토"
      >
        <h2>
          우선 검토{" "}
          <span>{tierEntries(qualityTiers[0]).length}개 독립 발견</span>
        </h2>
        <p className="quality-caption">
          핵심 항목과 원본 관계가 명확한 차이부터 확인하세요. 금액 크기로
          정렬하지 않습니다.
        </p>
        {!tierEntries(qualityTiers[0]).length && (
          <p className="section-empty">
            우선 검토할 독립 발견이 없습니다. 추가 검토와 상세 분석 기록을
            확인하세요. 정상 판정이라는 뜻은 아닙니다.
          </p>
        )}
        {tierEntries(qualityTiers[0]).map((e) => card(e.finding))}
      </section>
      <details
        className="quality-extra"
        open={showAdditional || followTier === qualityTiers[1]}
        onToggle={(e) => {
          setShowAdditional(e.currentTarget.open);
          if (!e.currentTarget.open) setFollowId("");
        }}
      >
        <summary>
          추가 검토{" "}
          <span>
            {tierEntries(qualityTiers[1]).length}건 · 연결·범위·기간 확인
          </span>
        </summary>
        <section aria-label="추가 검토">{grouped(qualityTiers[1])}</section>
      </details>
      <details
        className="quality-records"
        open={showRecords || followTier === qualityTiers[2]}
        onToggle={(e) => {
          setShowRecords(e.currentTarget.open);
          if (!e.currentTarget.open) setFollowId("");
        }}
      >
        <summary>
          상세 분석 기록{" "}
          <span>
            {tierEntries(qualityTiers[2]).length}건 · 반복·조건 차이·보류·통과
            기록
          </span>
        </summary>
        <section aria-label="상세 분석 기록">
          <p className="quality-caption">
            원본과 개별 근거를 모두 보존합니다. 부적합한 연결은 비교에서
            제외했으며, 보류는 통과가 아닙니다.
          </p>
          {grouped(qualityTiers[2])}
        </section>
      </details>
    </section>
  );
}
