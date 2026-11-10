import { useState, useRef, useEffect } from "react";
import { Button } from "./ui/button";
import { fieldLabels, units } from "../normalization/types";
import type { Candidate, Link, Field, Unit } from "../normalization/types";
import { canConfirm } from "../normalization/values";
import { suggestLinks } from "../normalization/links";
import { candidateValue } from "../presentation/workflow";
import { formatFinancial } from "../presentation/format";
type Props = {
  coreIds?: string[];
  reasons?: { ids: string[]; reason: string; title: string }[];
  focusIds?: string[];
  items: Candidate[];
  links: Link[];
  onEdit: (id: string, patch: Partial<Candidate>) => void;
  onConfirm: (id: string) => void;
  onAdd: () => void;
  onLink: (a: string, b: string) => void;
  onUnlink: (id: string) => void;
};

/** 목록은 항목·값·원본·확인 상태만 보여주고 모든 수정 기능은 행의 상세 편집에서 유지한다. */
export function ReviewView({
  coreIds,
  reasons = [],
  items,
  links,
  onEdit,
  onConfirm,
  onAdd,
  onLink,
  onUnlink,
  focusIds = [],
}: Props) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focusIds.length) {
      root.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
      root.current?.focus({ preventScroll: true });
    }
  }, [focusIds]);
  const [filter, setFilter] = useState(
      focusIds.length ? "관련 항목" : coreIds ? "핵심 확인" : "전체",
    ),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [a, setA] = useState(""),
    [b, setB] = useState(""),
    [linkPage, setLinkPage] = useState(0);
  const active = items.filter((c) => !c.excluded),
    query = search.trim().toLowerCase();
  const filtered = items.filter(
    (c) =>
      (filter === "제외됨"
        ? c.excluded
        : !c.excluded &&
          (filter === "전체" ||
            (filter === "핵심 확인" && !!coreIds?.includes(c.id)) ||
            (filter === "미확인" && !c.confirmed) ||
            (filter === "관련 항목" && focusIds.includes(c.id)) ||
            c.source === filter)) &&
      (!query ||
        [c.label, c.location, c.fileName].some((v) =>
          v.toLowerCase().includes(query),
        )),
  );
  const pageIndex = Math.min(
      page,
      Math.max(0, Math.ceil(filtered.length / 20) - 1),
    ),
    suggestions = suggestLinks(items, links),
    linkIndex = Math.min(
      linkPage,
      Math.max(0, Math.ceil(suggestions.length / 20) - 1),
    );
  const find = (id: string) => items.find((c) => c.id === id);
  const describe = (c: Candidate | undefined) =>
    c
      ? `${c.label} · ${candidateValue(c)} · ${c.location} · ${c.asOf || "기준일 미확인"} · ${c.period || "기간 미확인"} · ${c.scenario || "시나리오 미확인"}`
      : "삭제된 항목";
  return (
    <section
      ref={root}
      tabIndex={-1}
      className="review"
      aria-label="데이터 확인"
    >
      <div className="review-toolbar">
        <h2>재무 항목 후보</h2>
        <span className="muted">
          {active.length}개 · 확인 완료{" "}
          {active.filter((c) => c.confirmed).length}개 · 제외{" "}
          {items.length - active.length}개
        </span>
        <Button
          variant="outline"
          onClick={() => {
            setFilter("전체");
            setSearch("");
            setPage(0);
            onAdd();
          }}
        >
          항목 직접 추가
        </Button>
      </div>
      <p className="notice">
        필요한 항목만 확인하세요. 기준일·기간·시나리오·항목 유형·확정 여부와
        모든 수정 기능은 ‘상세 편집’에 있습니다. 확인되지 않은 값은 확정 오류로
        판정하지 않습니다.
      </p>
      {coreIds && (
        <p className="review-progress" role="status">
          핵심 확인 진행:{" "}
          {
            items.filter(
              (c) => coreIds.includes(c.id) && !c.excluded && c.confirmed,
            ).length
          }{" "}
          / {items.filter((c) => coreIds.includes(c.id) && !c.excluded).length}
          개 · 값 확인과 검증 승인은 별개입니다. 전체 후보는 목록 필터의
          ‘전체’에서 볼 수 있습니다.
        </p>
      )}
      <div className="review-filters">
        <label>
          목록 필터
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
          >
            {[
              ...(coreIds ? ["핵심 확인"] : []),
              "전체",
              "미확인",
              "XLSX",
              "DOCX",
              "제외됨",
              ...(focusIds.length ? ["관련 항목"] : []),
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          항목 검색
          <input
            type="search"
            value={search}
            placeholder="항목명 또는 원본 위치"
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </label>
      </div>
      <div className="table-scroll review-table compact-review">
        <table>
          <thead>
            <tr>
              <th>항목명</th>
              <th>값·단위</th>
              <th>원본</th>
              <th>확인 상태</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(pageIndex * 20, (pageIndex + 1) * 20).map((c) => (
              <tr key={c.id} className={c.excluded ? "excluded" : ""}>
                <td>
                  <strong>{c.label}</strong>
                  {coreIds?.includes(c.id) && (
                    <small className="review-reason">
                      {reasons.find((r) => r.ids.includes(c.id))?.title ??
                        "주요 재무 항목"}
                      에 사용됩니다.{" "}
                      {reasons.find((r) => r.ids.includes(c.id))?.reason ??
                        "원본과 값·단위·기준을 확인해야 검증에 사용할 수 있습니다."}
                    </small>
                  )}
                  <details
                    className="candidate-editor"
                    name="candidate-editor"
                    open={c.method === "직접 입력" && !c.confirmed}
                  >
                    <summary>상세 편집</summary>
                    <div className="candidate-editor-grid">
                      <label>
                        항목명
                        <input
                          value={c.label}
                          onChange={(e) =>
                            onEdit(c.id, { label: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        항목 유형
                        <select
                          value={c.field}
                          onChange={(e) =>
                            onEdit(c.id, { field: e.target.value as Field })
                          }
                        >
                          {Object.entries(fieldLabels).map(([key, value]) => (
                            <option key={key} value={key}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        숫자
                        <input
                          inputMode="decimal"
                          value={c.number}
                          onChange={(e) =>
                            onEdit(c.id, { number: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        단위
                        <select
                          value={c.unit}
                          onChange={(e) =>
                            onEdit(c.id, { unit: e.target.value as Unit })
                          }
                        >
                          {units.map((u) => (
                            <option key={u}>{u}</option>
                          ))}
                        </select>
                      </label>
                      {(["asOf", "period", "scenario"] as const).map(
                        (key, i) => (
                          <label key={key}>
                            {["기준일", "적용 기간 / 기한", "시나리오"][i]}
                            <input
                              value={c[key]}
                              placeholder="미확인"
                              onChange={(e) =>
                                onEdit(c.id, { [key]: e.target.value })
                              }
                            />
                          </label>
                        ),
                      )}
                      <label>
                        확정 여부
                        <select
                          value={c.certainty}
                          onChange={(e) =>
                            onEdit(c.id, {
                              certainty: e.target
                                .value as Candidate["certainty"],
                            })
                          }
                        >
                          {["미확인", "확정", "가정", "조건부"].map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      </label>
                      {c.method === "직접 입력" && (
                        <>
                          <label>
                            원본 종류
                            <select
                              value={c.source}
                              onChange={(e) =>
                                onEdit(c.id, {
                                  source: e.target.value as Candidate["source"],
                                })
                              }
                            >
                              <option>XLSX</option>
                              <option>DOCX</option>
                            </select>
                          </label>
                          <label>
                            참조 파일명
                            <input
                              value={c.fileName}
                              onChange={(e) =>
                                onEdit(c.id, { fileName: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            참조 위치
                            <input
                              value={c.location}
                              onChange={(e) =>
                                onEdit(c.id, { location: e.target.value })
                              }
                            />
                          </label>
                        </>
                      )}
                      <p>
                        정규화:{" "}
                        {c.normalizedValue === null
                          ? "확인 필요"
                          : formatFinancial(
                              c.normalizedValue,
                              ["원", "만 원", "억 원"].includes(c.unit)
                                ? "원"
                                : c.unit,
                              { spaced: true },
                            )}
                      </p>
                    </div>
                  </details>
                </td>
                <td>
                  <p
                    className="candidate-value"
                    title={`추출 숫자: ${c.number || "없음"} ${c.unit}`}
                  >
                    {candidateValue(c)}
                  </p>
                </td>
                <td>
                  <strong>{c.source}</strong>
                  <p>{c.fileName}</p>
                  <small>{c.location}</small>
                  <details className="source-context">
                    <summary>원본 문맥</summary>
                    <p className="pre">
                      {c.originalText || "직접 추가한 항목"}
                    </p>
                    <p>추출 숫자: {c.originalNumber ?? "없음"}</p>
                    <small>
                      {c.method} · {c.confidence}
                    </small>
                    <p className="muted">{c.note}</p>
                  </details>
                </td>
                <td>
                  <p className={c.confirmed ? "confirmed" : "warning"}>
                    {c.confirmed ? "사용자 확인 완료" : "확인 필요"}
                  </p>
                  <Button
                    variant="outline"
                    disabled={c.confirmed || !canConfirm(c)}
                    onClick={() => onConfirm(c.id)}
                  >
                    확인 완료
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => onEdit(c.id, { excluded: !c.excluded })}
                  >
                    {c.excluded ? "복원" : "제외"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && (
        <p className="empty">
          표시할 후보가 없습니다. 검색·필터를 확인하거나 필요한 항목을 직접
          추가하세요.
        </p>
      )}
      <div className="pagination">
        <Button
          variant="outline"
          disabled={!pageIndex}
          onClick={() => setPage(pageIndex - 1)}
        >
          이전 후보
        </Button>
        <span>
          {pageIndex + 1} / {Math.max(1, Math.ceil(filtered.length / 20))}
        </span>
        <Button
          variant="outline"
          disabled={(pageIndex + 1) * 20 >= filtered.length}
          onClick={() => setPage(pageIndex + 1)}
        >
          다음 후보
        </Button>
      </div>
      <section className="link-section">
        <h2>Excel · Word 항목 연결</h2>
        <p className="muted">
          금액 차이와 무관하게 유형·단위가 맞는 후보를 제안합니다.
          기준일·기간·시나리오 차이는 원문에서 확인하고 승인하세요.
          편집·제외·파일 교체 시 관련 승인은 해제됩니다.
        </p>
        <div className="manual-link">
          <label>
            Excel 항목
            <select value={a} onChange={(e) => setA(e.target.value)}>
              <option value="">선택</option>
              {active
                .filter((c) => c.source === "XLSX")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {describe(c)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Word 항목
            <select value={b} onChange={(e) => setB(e.target.value)}>
              <option value="">선택</option>
              {active
                .filter((c) => c.source === "DOCX")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {describe(c)}
                  </option>
                ))}
            </select>
          </label>
          <Button
            disabled={
              !active.some((c) => c.id === a) || !active.some((c) => c.id === b)
            }
            onClick={() => onLink(a, b)}
          >
            선택 항목 연결 승인
          </Button>
        </div>
        <details>
          <summary>연결 제안 {suggestions.length}개</summary>
          {suggestions.slice(linkIndex * 20, (linkIndex + 1) * 20).map((s) => (
            <div className="link-row" key={`${s.xlsxId}:${s.docxId}`}>
              <p>{describe(find(s.xlsxId))}</p>
              <p>{describe(find(s.docxId))}</p>
              <p className="warning">{s.reason}</p>
              <Button
                variant="outline"
                onClick={() => onLink(s.xlsxId, s.docxId)}
              >
                연결 승인
              </Button>
            </div>
          ))}
          <div className="pagination">
            <Button
              variant="outline"
              disabled={!linkIndex}
              onClick={() => setLinkPage(linkIndex - 1)}
            >
              이전 제안
            </Button>
            <span>
              {linkIndex + 1} /{" "}
              {Math.max(1, Math.ceil(suggestions.length / 20))}
            </span>
            <Button
              variant="outline"
              disabled={(linkIndex + 1) * 20 >= suggestions.length}
              onClick={() => setLinkPage(linkIndex + 1)}
            >
              다음 제안
            </Button>
          </div>
        </details>
        <h3>승인한 연결 {links.length}개</h3>
        {links.map((l) => (
          <div className="link-row" key={l.id}>
            <p>{describe(find(l.xlsxId))}</p>
            <p>{describe(find(l.docxId))}</p>
            <Button variant="outline" onClick={() => onUnlink(l.id)}>
              연결 해제
            </Button>
          </div>
        ))}
      </section>
    </section>
  );
}
