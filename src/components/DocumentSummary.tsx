import type { Candidate } from "../normalization/types";
import type { Workbook, WordDocument } from "../parsers/types";
import { coreFields } from "../recommendations/types";
import { candidateValue } from "../presentation/workflow";
/** 실제 파싱 결과의 문서 구성과 대표 후보만 요약하고 나머지는 원본 상세에 남긴다. */
export function DocumentSummary({
  data,
  items,
}: {
  data: Workbook | WordDocument;
  items: Candidate[];
}) {
  const structure =
    "sheets" in data
      ? `시트 ${data.sheets.length}개 · 셀 ${data.sheets.reduce((n, s) => n + s.cells.length, 0).toLocaleString()}개`
      : `본문 문단 ${data.blocks.filter((b) => b.kind === "paragraph").length}개 · 표 ${data.blocks.filter((b) => b.kind === "table").length}개`;
  const major = items.filter((c) => coreFields.includes(c.field)).slice(0, 5);
  return (
    <div className="document-summary">
      <p className="source">원본: {data.fileName}</p>
      <p>
        {structure} · 재무 항목 후보 {items.length}개
      </p>
      <h3>주요 재무 항목</h3>
      {major.length ? (
        <ul>
          {major.map((c) => (
            <li key={c.id}>
              <span>{c.label}</span>
              <strong title={`추출 숫자: ${c.number || "없음"} ${c.unit}`}>
                {candidateValue(c)}
              </strong>
              <small>
                {c.location} ·{" "}
                {c.confirmed ? "사용자 확인 완료" : "사용자 미확인"}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          주요 항목을 자동으로 찾지 못했습니다. 원본 상세를 확인하고 필요한
          항목을 직접 추가하세요.
        </p>
      )}
      <p className="muted">
        일부 후보만 요약했습니다. 전체 항목과 단위는 데이터 확인에서 검토하세요.
      </p>
    </div>
  );
}
