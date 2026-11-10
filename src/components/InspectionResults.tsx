import { useState, useRef, useEffect } from "react";
import type { Finding, InspectionInput } from "../inspection/analyze";
import type { Recommendation } from "../recommendations/types";
import type { Candidate } from "../normalization/types";
import type { Result } from "../validation/types";
import { displayValue } from "../presentation/results";
import { candidateValue } from "../presentation/workflow";
import { RecommendationDetail } from "./RecommendationCenter";
import { Button } from "./ui/button";
const kinds = {
  CALC: "계산",
  CROSS: "문서 간 비교",
  ALLOC: "자금 배정",
  PLAN: "조건부 금액·계획",
};
type Props = InspectionInput & {
  findings: Finding[];
  started: boolean;
  onEdit: (id: string, patch: Partial<Candidate>) => void;
  onApply: (r: Recommendation, approve: boolean) => void;
  onInspect: (ids: string[]) => void;
  onPlan: (r: Recommendation) => void;
  onStart: () => void;
  onPrepare: (result: Result) => void;
};
/** 자동 발견 후보와 사용자 확인 후 판정을 구분하고 선택한 근거만 상세 검토한다. */
export function InspectionResults(props: Props) {
  const { findings, started, onInspect } = props;
  const [kind, setKind] = useState("전체"),
    [extra, setExtra] = useState(false),
    [selected, setSelected] = useState("");
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected) {
      detailRef.current?.scrollIntoView?.({ block: "start" });
      detailRef.current?.focus();
    }
  }, [selected]);
  const visible = findings.filter(
    (f) =>
      (kind === "전체" || kind === f.kind) &&
      (extra || kind !== "전체" || f.primary || f.approved),
  );
  const chosen = findings.find((f) => f.id === selected);
  const count = (status: string) =>
    findings.filter((f) => f.approved?.status === status).length;
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
    <section className="inspection-results" aria-label="자동 검사 결과">
      <div className="inspection-heading">
        <h2>검사 결과</h2>
        <span>자동 발견은 사용자 승인이 아닙니다</span>
      </div>
      <div className="inspection-counts">
        <strong>확정 오류 {count("오류")}</strong>
        <span>확인 후 통과 {count("검증 통과")}</span>
        <span>
          수치 차이 후보{" "}
          {
            findings.filter(
              (f) => f.signal === "수치 차이" && !f.approved && f.primary,
            ).length
          }
        </span>
        <span>
          조건 확인{" "}
          {
            findings.filter(
              (f) => !f.approved && f.primary && f.signal !== "수치 차이",
            ).length
          }
        </span>
      </div>
      <p className="notice">
        추천 관계를 바탕으로 숫자를 대조했습니다. 자동 발견 후보는 모두 확인
        대상이며, 같은 기준의 값인지 검토하기 전에는 오류나 정상으로 확정하지
        않습니다.
      </p>
      <p className="inspection-coverage">
        {Object.entries(kinds)
          .map(
            ([key, label]) =>
              `${label} ${findings.filter((f) => f.kind === key).length}건`,
          )
          .join(" · ")}
        <br />
        관계나 조건을 찾지 못한 범위는 검사 완료가 아닙니다. 유형 필터에서 추가
        후보와 누락 조건을 확인하세요.
      </p>
      <div className="inspection-filters">
        <label>
          오류 유형
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
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
            checked={extra}
            onChange={(e) => setExtra(e.target.checked)}
          />{" "}
          반복·정보 부족 후보도 보기 (
          {findings.filter((f) => !f.primary && !f.approved).length})
        </label>
        <span>{visible.length}개 표시</span>
      </div>
      {!visible.length && (
        <p className="empty">
          이 범위에서 표시할 후보가 없습니다. 전체 검증을 통과했다는 뜻은
          아닙니다. 다른 유형이나 추가 후보를 확인하세요.
        </p>
      )}
      <div className="finding-list">
        {visible.map((f) => {
          const r = f.approved ?? f.result;
          return (
            <article className="finding" key={f.id}>
              <div className="finding-heading">
                <h3>{f.title}</h3>
                <span
                  className={
                    f.approved?.status === "오류"
                      ? "result-error"
                      : f.approved?.status === "검증 통과"
                        ? "result-pass"
                        : "result-review"
                  }
                >
                  {f.approved
                    ? `사용자 확인 후 · ${f.approved.status}`
                    : `자동 발견 · ${f.signal === "수치 일치" ? "수치 일치 후보" : "확인 필요"}`}
                </span>
              </div>
              <p className="muted">
                {kinds[f.kind]}
                {f.recommendation?.risks.some((x) => x.includes("반복"))
                  ? " · 반복 후보가 있어 원본 선택 필요"
                  : ""}
              </p>
              <div className="finding-values">
                {r.evidence.slice(0, f.kind === "CROSS" ? 2 : 4).map((c) => (
                  <p key={c.id}>
                    <strong>
                      {c.source} · {candidateValue(c)}
                    </strong>
                    <small>
                      {c.label} · {c.fileName} · {c.location}
                    </small>
                  </p>
                ))}
              </div>
              {r.difference !== null && (
                <p className="finding-comparison">
                  {f.kind === "CROSS"
                    ? "두 값의 차이"
                    : "문서값과 추천 계산값 차이"}
                  :{" "}
                  <strong>
                    {displayValue(
                      Math.abs(r.difference),
                      r.unit === "%" ? "%p" : r.unit,
                    )}
                  </strong>
                  {f.kind === "CALC" && (
                    <> · 추천 계산값 {displayValue(r.expected, r.unit)}</>
                  )}
                </p>
              )}
              <details>
                <summary>판단 근거와 확인할 내용</summary>
                <p className="pre">{r.basis}</p>
                {r.evidence.map((c) => (
                  <div className="finding-evidence" key={c.id}>
                    <strong>
                      {c.source} · {c.location}
                    </strong>
                    <p className="pre">{c.originalText || "직접 입력"}</p>
                    <small>
                      기준일 {c.asOf || "미확인"} · 시나리오{" "}
                      {c.scenario || "미확인"} · {c.certainty}
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
                <small>{r.code}</small>
              </details>
              <div className="finding-actions">
                {f.recommendation && (
                  <Button variant="outline" onClick={() => setSelected(f.id)}>
                    {f.approved ? "확인 내용 수정" : "이 항목 검토"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={!r.evidence.length}
                  onClick={() => onInspect(r.evidence.map((c) => c.id))}
                >
                  관련 원본·데이터 수정
                </Button>
                {!f.recommendation &&
                  f.kind !== "CROSS" &&
                  f.kind !== "CALC" && (
                    <Button
                      variant="outline"
                      onClick={() => props.onPrepare(r)}
                    >
                      배정·계획 조건 확인
                    </Button>
                  )}
              </div>
            </article>
          );
        })}
      </div>
      {chosen?.recommendation && (
        <section
          ref={detailRef}
          tabIndex={-1}
          className="focused-review"
          aria-label="선택 항목 상세 검토"
        >
          <h2>{chosen.questions[0] ?? "이 원본 관계와 적용 조건이 맞나요?"}</h2>
          <p>
            이 항목에 사용된 원본만 확인하세요. 숫자 차이가 있어도 기준이 다르면
            보류됩니다.
          </p>
          <RecommendationDetail
            key={chosen.id}
            {...props}
            recommendations={[]}
            recommendation={chosen.recommendation}
            headline={chosen.title}
            onApplied={() => setSelected("")}
          />
          <Button variant="outline" onClick={() => setSelected("")}>
            상세 검토 닫기
          </Button>
        </section>
      )}
    </section>
  );
}
