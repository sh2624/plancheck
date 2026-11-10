import { useMemo, useState } from "react";
import type { Candidate, Link } from "../normalization/types";
import { Button } from "./ui/button";
import { newCalculation, rules, ruleTitles } from "../validation/types";
import type { Calculation, Rule, Status } from "../validation/types";
import { validateAll } from "../validation/engine";
type Props = {
  items: Candidate[];
  links: Link[];
  calculations: Calculation[];
  onChange: (next: Calculation[]) => void;
  onInspect: (ids: string[]) => void;
};
const statusClass: Record<Status, string> = {
  오류: "result-error",
  "확인 필요": "result-review",
  "검증 통과": "result-pass",
  "검증 불가": "result-unavailable",
};
/** 선택 범위 설정과 현재 데이터로 계산한 결과를 표시하며 모든 판정의 원본 근거를 연다. */
export function ResultsView({
  items,
  links,
  calculations,
  onChange,
  onInspect,
}: Props) {
  const [selected, setSelected] = useState(""),
    [filter, setFilter] = useState("전체"),
    [addRule, setAddRule] = useState<Rule>("assets");
  const results = useMemo(
    () => validateAll(items, links, calculations),
    [items, links, calculations],
  );
  const visible = results.filter(
    (r) => filter === "전체" || r.status === filter,
  );
  const detail = results.find((r) => r.id === selected);
  const describe = (c: Candidate) =>
    `${c.label} · ${c.number} ${c.unit} · ${c.source} ${c.location} · ${c.period || "기간 미확인"} · ${c.confirmed ? "확인됨" : "미확인"}`;
  function update(id: string, patch: Partial<Calculation>) {
    onChange(
      calculations.map((s) =>
        s.id === id
          ? { ...s, ...patch, scopeConfirmed: patch.scopeConfirmed ?? false }
          : s,
      ),
    );
  }
  const choose = (
    label: string,
    fields: string[],
    value: string[],
    many: boolean,
    onSelect: (ids: string[]) => void,
  ) => (
    <label className="calculation-picker">
      {label}
      <select
        multiple={many}
        size={many ? 5 : 1}
        value={many ? value : (value[0] ?? "")}
        onChange={(e) =>
          onSelect(
            many
              ? Array.from(e.target.selectedOptions).map((o) => o.value)
              : e.target.value
                ? [e.target.value]
                : [],
          )
        }
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
    <section className="results" aria-label="검수 결과">
      <div className="review-toolbar">
        <h2>핵심 검증</h2>
        <span className="muted">
          확인된 항목만 판정 · 승인 연결 {links.length}개
        </span>
      </div>
      <p className="notice">
        전체 후보를 확인할 필요는 없습니다. 계산에 쓸 항목만 확인하고 범위를
        선택하세요. 같은 항목의 반복 출현과 소계를 함께 합산하지 마세요.
        기준일·시나리오·확정 여부가 불명확하면 확정 오류로 판정하지 않습니다.
      </p>
      <details className="calculation-settings" open>
        <summary>계산 범위 및 대출 조건</summary>
        <p className="muted">
          복수 선택은 Ctrl 또는 Shift와 함께 선택합니다. 합계 검증은 선택한
          항목의 완전성을 사용자가 확인해야 합니다. 지출·저축이 없으면 확인된
          0원 항목을 직접 추가하세요.
        </p>
        {calculations.map((s, index) => (
          <fieldset key={s.id}>
            <legend>
              {index + 1}. {ruleTitles[s.rule]}
            </legend>
            <div className="calculation-grid">
              {choose(
                "검사할 문서값",
                [rules[s.rule].target],
                s.targetId ? [s.targetId] : [],
                false,
                (ids) => update(s.id, { targetId: ids[0] ?? "" }),
              )}
              {rules[s.rule].groups.map((g) => (
                <div key={g.key}>
                  {choose(
                    g.label,
                    g.fields,
                    s.groups[g.key] ?? [],
                    g.many,
                    (ids) =>
                      update(s.id, { groups: { ...s.groups, [g.key]: ids } }),
                  )}
                </div>
              ))}
              <label>
                허용오차 (원)
                <input
                  inputMode="decimal"
                  value={s.tolerance}
                  onChange={(e) => update(s.id, { tolerance: e.target.value })}
                />
              </label>
              {s.rule === "loan" && (
                <>
                  <label>
                    상환방식
                    <select
                      value={s.loanMethod}
                      onChange={(e) =>
                        update(s.id, {
                          loanMethod: e.target
                            .value as Calculation["loanMethod"],
                        })
                      }
                    >
                      {["미확인", "원리금균등", "기타"].map((v) => (
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
                          loanBasis: e.target.value as Calculation["loanBasis"],
                        })
                      }
                    >
                      {[
                        "미확인",
                        "최초 원금·전체 기간",
                        "현재 잔액·잔여 기간",
                      ].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    거치기간 (개월, 없으면 0)
                    <input
                      inputMode="numeric"
                      value={s.graceMonths}
                      onChange={(e) =>
                        update(s.id, { graceMonths: e.target.value })
                      }
                    />
                  </label>
                  <p className="muted">
                    같은 대출의 고정 연금리와 원금·기간 조합을 선택하세요. 거치
                    0개월만 지원하며 수수료·보험료는 포함하지 않습니다.
                  </p>
                </>
              )}
            </div>
            <label className="scope-confirm">
              <input
                type="checkbox"
                checked={s.scopeConfirmed}
                onChange={(e) =>
                  update(s.id, { scopeConfirmed: e.target.checked })
                }
              />
              선택한 항목이 동일 범위·기간에 속하고 구성 항목 누락·소계 중복이
              없음을 확인했습니다.
              {s.rule === "loan"
                ? " 같은 대출의 고정금리 약정·거치 및 기간 기준도 확인했습니다."
                : ""}
            </label>
            <Button
              variant="outline"
              onClick={() =>
                onInspect(
                  [s.targetId, ...Object.values(s.groups).flat()].filter(
                    Boolean,
                  ),
                )
              }
            >
              선택 항목 확인·수정
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                onChange(calculations.filter((c) => c.id !== s.id))
              }
            >
              계산 설정 삭제
            </Button>
          </fieldset>
        ))}
        <div className="manual-link">
          <label>
            추가할 계산
            <select
              value={addRule}
              onChange={(e) => setAddRule(e.target.value as Rule)}
            >
              {Object.entries(ruleTitles).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            onClick={() =>
              onChange([
                ...calculations,
                newCalculation(addRule, crypto.randomUUID()),
              ])
            }
          >
            계산 추가
          </Button>
        </div>
      </details>
      <div className="result-counts">
        {(["오류", "확인 필요", "검증 통과", "검증 불가"] as const).map(
          (status) => (
            <span key={status} className={statusClass[status]}>
              {status} {results.filter((r) => r.status === status).length}
            </span>
          ),
        )}
      </div>
      <label className="review-filter">
        결과 필터
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          {["전체", "오류", "확인 필요", "검증 통과", "검증 불가"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>코드 / 제목</th>
              <th>상태</th>
              <th>Excel 값·위치</th>
              <th>Word 값·위치</th>
              <th>문서값 / 비교·계산값 / 차이</th>
              <th>판단 근거 / 확인 사항</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td>
                  <Button variant="outline" onClick={() => setSelected(r.id)}>
                    {r.code} · {r.title}
                  </Button>
                </td>
                <td>
                  <span className={statusClass[r.status]}>{r.status}</span>
                </td>
                {(["XLSX", "DOCX"] as const).map((source) => (
                  <td key={source}>
                    {r.evidence
                      .filter((c) => c.source === source)
                      .map((c, i) => (
                        <p key={`${c.id}:${i}`}>
                          {c.label}: {c.number} {c.unit}
                          <br />
                          {c.fileName} · {c.location}
                        </p>
                      ))}
                  </td>
                ))}
                <td>
                  <p>
                    문서값: {r.actual ?? "—"} {r.unit}
                  </p>
                  <p>
                    비교·계산값: {r.expected ?? "—"} {r.unit}
                  </p>
                  <p>
                    차이: {r.difference ?? "—"} {r.unit === "%" ? "%p" : r.unit}
                  </p>
                </td>
                <td>
                  <p>{r.basis}</p>
                  {r.needs.map((n, i) => (
                    <p className="warning" key={i}>
                      {n}
                    </p>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && (
        <p className="empty">
          표시할 검증 결과가 없습니다. 계산을 설정하거나 문서 간 연결을
          승인하세요.
        </p>
      )}
      {detail && (
        <section className="result-detail" aria-label="검증 근거 상세">
          <h3>
            {detail.code} · {detail.title} · {detail.status}
          </h3>
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
                {c.fileName} · 기준일 {c.asOf || "미확인"} · 시나리오{" "}
                {c.scenario || "미확인"} · {c.certainty}
              </p>
              <p className="pre">{c.originalText || "직접 입력"}</p>
              <p>
                원본 숫자 {c.originalNumber ?? "없음"} · 현재 정규화 값{" "}
                {c.normalizedValue ?? "미확인"}
              </p>
            </article>
          ))}
          <Button
            variant="outline"
            onClick={() => onInspect(detail.evidence.map((c) => c.id))}
          >
            관련 항목 확인·수정
          </Button>
        </section>
      )}
    </section>
  );
}
