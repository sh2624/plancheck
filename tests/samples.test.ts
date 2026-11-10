import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseXlsx } from "../src/parsers/xlsx";
import { parseDocx } from "../src/parsers/docx";
const xlsxPath = process.env.PLANCHECK_XLSX;
const docxPath = process.env.PLANCHECK_DOCX;
it.skipIf(!xlsxPath || !docxPath)("사용자가 지정한 실제 문서를 끝까지 추출한다", async () => {
  const bytes = (path: string) => {
    const b = readFileSync(path);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const book = await parseXlsx(bytes(xlsxPath!), "private.xlsx");
  const word = await parseDocx(bytes(docxPath!), "private.docx");
  expect(book.sheets.length).toBeGreaterThan(0);
  expect(book.sheets.flatMap((s) => s.cells).length).toBeGreaterThan(0);
  expect(word.blocks.some((b) => b.kind === "paragraph")).toBe(true);
  expect(word.blocks.some((b) => b.kind === "table")).toBe(true);
  console.log(
    JSON.stringify({
      sheets: book.sheets.length,
      cells: book.sheets.reduce((n, s) => n + s.cells.length, 0),
      formulas: book.sheets.flatMap((s) => s.cells).filter((c) => c.formula).length,
      review: book.sheets.flatMap((s) => s.cells).filter((c) => c.review).length,
      paragraphs: word.blocks.filter((b) => b.kind === "paragraph").length,
      tables: word.blocks.filter((b) => b.kind === "table").length,
    }),
  );
});
