import { useMemo, useState } from "react";
import { flexRender, getCoreRowModel, getPaginationRowModel, useReactTable } from "@tanstack/react-table";
import type { ColumnDef } from "@tanstack/react-table";
import type { Cell, Workbook } from "../parsers/types";
import { Button } from "./ui/button";
/** 셀 원문과 수식 캐시를 페이지 단위로 표시한다. */
function CellTable({ cells }: { cells: Cell[] }) {
  const columns = useMemo<ColumnDef<Cell>[]>(
    () => [
      { accessorKey: "address", header: "셀 위치" },
      {
        accessorKey: "value",
        header: "원본 값",
        cell: (x) => <span className="pre">{String(x.getValue() ?? "")}</span>,
      },
      { accessorKey: "raw", header: "XML 원본 값" },
      {
        accessorKey: "formula",
        header: "수식",
        cell: (x) => (x.getValue() ? <code>{String(x.getValue())}</code> : "—"),
      },
      {
        accessorKey: "result",
        header: "저장된 계산 결과",
        cell: (x) => (x.getValue() === undefined ? "—" : String(x.getValue())),
      },
      {
        id: "status",
        header: "추출 상태",
        cell: ({ row }) => (
          <span className={row.original.review ? "warning" : "muted"}>
            {row.original.review ? "확인 필요" : row.original.formula ? "캐시 있음 · 미검증" : "추출됨"}
          </span>
        ),
      },
    ],
    [],
  );
  const table = useReactTable({
    data: cells,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 50 } },
  });
  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            {table.getHeaderGroups().map((g) => (
              <tr key={g.id}>
                {g.headers.map((h) => (
                  <th key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id}>
                {r.getVisibleCells().map((c) => (
                  <td key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <Button variant="outline" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
          이전
        </Button>
        <span>
          {table.getState().pagination.pageIndex + 1} / {Math.max(1, table.getPageCount())} 페이지 ·{" "}
          {cells.length.toLocaleString()}개 셀
        </span>
        <Button variant="outline" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
          다음
        </Button>
      </div>
    </>
  );
}
/** 선택한 시트의 원본 위치와 병합 영역을 표시한다. */
export function WorkbookView({ data }: { data: Workbook }) {
  const [selected, setSelected] = useState(0);
  const sheet = data.sheets[selected] ?? data.sheets[0];
  return (
    <div>
      <p className="source">원본: {data.fileName}</p>
      <label className="sheet-label">
        시트{" "}
        <select value={selected} onChange={(e) => setSelected(Number(e.target.value))}>
          {data.sheets.map((s, i) => (
            <option key={i} value={i}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <p className="notice">
        수식은 재계산하지 않습니다. 저장된 결과도 최신 여부를 확인해야 합니다. 날짜·백분율은 XML 저장값으로 표시됩니다.
      </p>
      {sheet.merges.length > 0 && (
        <details>
          <summary>병합 영역 {sheet.merges.length}개</summary>
          <p>{sheet.merges.join(", ")}</p>
        </details>
      )}
      <CellTable key={selected} cells={sheet.cells} />
    </div>
  );
}
