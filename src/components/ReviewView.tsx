import { useState } from "react";
import { Button } from "./ui/button";
import { fieldLabels, units } from "../normalization/types";
import type { Candidate, Link, Field, Unit } from "../normalization/types";
import { canConfirm } from "../normalization/values";
import { suggestLinks } from "../normalization/links";
type Props = {
  items: Candidate[];
  links: Link[];
  onEdit: (id: string, patch: Partial<Candidate>) => void;
  onConfirm: (id: string) => void;
  onAdd: () => void;
  onLink: (a: string, b: string) => void;
  onUnlink: (id: string) => void;
};
/** 원문과 편집 값을 나란히 검토하고 문서 연결을 명시적으로 승인하는 작업 화면. */
export function ReviewView({
  items,
  links,
  onEdit,
  onConfirm,
  onAdd,
  onLink,
  onUnlink,
}: Props) {
  const [filter, setFilter] = useState("전체"),
    [page, setPage] = useState(0),
    [a, setA] = useState(""),
    [b, setB] = useState("");
  const active = items.filter((c) => !c.excluded),
    filtered = items.filter((c) =>
      filter === "제외됨"
        ? c.excluded
        : !c.excluded &&
          (filter === "전체" ||
            (filter === "미확인" && !c.confirmed) ||
            c.source === filter),
    );
  const pageIndex = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 20) - 1),
  );
  const suggestions = suggestLinks(items, links);
  const [linkPage, setLinkPage] = useState(0);
  const linkIndex = Math.min(
    linkPage,
    Math.max(0, Math.ceil(suggestions.length / 20) - 1),
  );
  const find = (id: string) => items.find((c) => c.id === id);
  const describe = (c: Candidate | undefined) =>
    c
      ? `${c.label} · ${c.number || "값 없음"} ${c.unit} · ${c.location} · ${c.asOf || "기준일 미확인"} · ${c.period || "기간 미확인"} · ${c.scenario || "시나리오 미확인"}`
      : "삭제된 항목";
  return (
    <section className="review" aria-label="데이터 확인">
      <div className="review-toolbar">
        <h2>재무 항목 후보</h2>
        <span className="muted">
          {active.length}개 · 확인 완료{" "}
          {active.filter((c) => c.confirmed).length}개 · 제외{" "}
          {items.length - active.length}개
        </span>
        <Button onClick={onAdd} variant="outline">
          항목 직접 추가
        </Button>
      </div>
      <p className="notice">
        자동 추출은 후보입니다. 원문과 단위·시점을 확인한 후 ‘확인 완료’를
        선택하세요. 금액은 원 단위로 반올림하며, 계산 오류 판정은 수행하지
        않습니다.
      </p>
      <label className="review-filter">
        목록 필터{" "}
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(0);
          }}
        >
          {["전체", "미확인", "XLSX", "DOCX", "제외됨"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      <div className="table-scroll review-table">
        <table>
          <thead>
            <tr>
              <th>원본 위치·문맥</th>
              <th>항목</th>
              <th>숫자·단위</th>
              <th>기준·적용 범위</th>
              <th>상태·확인</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(pageIndex * 20, (pageIndex + 1) * 20).map((c) => (
              <tr key={c.id} className={c.excluded ? "excluded" : ""}>
                <td>
                  <strong>
                    {c.source} · {c.location}
                  </strong>
                  <p>{c.fileName}</p>
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
                  <details>
                    <summary>원본 문맥</summary>
                    <p className="pre">
                      {c.originalText || "직접 추가한 항목"}
                    </p>
                    <p>추출 숫자: {c.originalNumber ?? "없음"}</p>
                  </details>
                  <small>
                    {c.method} · {c.confidence}
                  </small>
                  <p className="muted">{c.note}</p>
                </td>
                <td>
                  <label>
                    항목명
                    <input
                      value={c.label}
                      onChange={(e) => onEdit(c.id, { label: e.target.value })}
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
                      {Object.entries(fieldLabels).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                </td>
                <td>
                  <label>
                    숫자
                    <input
                      inputMode="decimal"
                      value={c.number}
                      onChange={(e) => onEdit(c.id, { number: e.target.value })}
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
                  <p>
                    정규화:{" "}
                    {c.normalizedValue === null
                      ? "확인 필요"
                      : `${c.normalizedValue.toLocaleString("ko-KR", { maximumFractionDigits: 10 })} ${["원", "만 원", "억 원"].includes(c.unit) ? "원" : c.unit}`}
                  </p>
                </td>
                <td>
                  {(["asOf", "period", "scenario"] as const).map((key, i) => (
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
                  ))}
                </td>
                <td>
                  <label>
                    확정 여부
                    <select
                      value={c.certainty}
                      onChange={(e) =>
                        onEdit(c.id, {
                          certainty: e.target.value as Candidate["certainty"],
                        })
                      }
                    >
                      {["미확인", "확정", "가정", "조건부"].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </label>
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
          표시할 후보가 없습니다. 문서를 업로드하거나 항목을 직접 추가하세요.
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
