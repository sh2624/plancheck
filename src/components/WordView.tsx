import type { Paragraph, WordDocument } from "../parsers/types";
/** 숫자 토큰과 해당 문단 전체를 함께 표시한다. */
function ParagraphView({ data }: { data: Paragraph }) {
  return (
    <div className="paragraph">
      <small>{data.location}</small>
      <p className="pre">{data.text || "(빈 문단)"}</p>
      {data.numbers.length > 0 && <p className="numbers">숫자 원문: {data.numbers.join(" · ")}</p>}
    </div>
  );
}
/** Word 문서 순서와 표의 원본 행·열 좌표를 유지한다. */
export function WordView({ data }: { data: WordDocument }) {
  return (
    <div>
      <p className="source">
        원본: {data.fileName} · 본문 블록 {data.blocks.length}개
      </p>
      <p className="notice">
        숫자는 원문 토큰이며 금액·단위로 확정하지 않았습니다. 표의 세로 병합은 원본 셀별로 표시합니다.
      </p>
      <div className="word-content">
        {data.blocks.map((block, i) =>
          block.kind === "paragraph" ? (
            <ParagraphView key={i} data={block} />
          ) : (
            <section key={i} className="word-table">
              <h3>{block.location}</h3>
              <div className="table-scroll">
                <table>
                  <tbody>
                    {block.rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci} colSpan={cell.span}>
                            <small>
                              {ri + 1}행 {cell.column}열{cell.span > 1 && ` · ${cell.span}열 병합`}
                              {cell.merge && ` · 세로 병합 ${cell.merge === "restart" ? "시작" : "계속"}`}
                            </small>
                            {cell.paragraphs.map((p, pi) => (
                              <ParagraphView key={pi} data={p} />
                            ))}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ),
        )}
      </div>
    </div>
  );
}
