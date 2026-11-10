import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
import { parseXlsx } from "../src/parsers/xlsx";
import { parseDocx } from "../src/parsers/docx";
import { extractWorkbook, extractWord } from "../src/normalization/extract";
import {
  extractPlanning,
  workbookReferences,
  wordReferences,
} from "../src/planning/extract";
import { emptyPlanning } from "../src/planning/types";
import { inspectDocuments } from "../src/inspection/analyze";
it.skipIf(!process.env.PLANCHECK_XLSX || !process.env.PLANCHECK_DOCX)(
  "실제 문서는 승인 없이 금리·잔액·합계 차이를 발견하고 원문 조건 차이는 보류한다",
  async () => {
    const bytes = (path: string) => {
      const b = readFileSync(path);
      return b.buffer.slice(
        b.byteOffset,
        b.byteOffset + b.byteLength,
      ) as ArrayBuffer;
    };
    const book = await parseXlsx(
        bytes(process.env.PLANCHECK_XLSX!),
        "input.xlsx",
      ),
      doc = await parseDocx(bytes(process.env.PLANCHECK_DOCX!), "input.docx");
    const items = [...extractWorkbook(book), ...extractWord(doc)],
      references = [...workbookReferences(book), ...wordReferences(doc)],
      p = extractPlanning(references),
      planning = { ...emptyPlanning(), actions: p.actions, funds: p.funds };
    const input = { items, links: [], calculations: [], planning, references },
      before = JSON.stringify(input),
      findings = inspectDocuments(input);
    const credit = findings.find(
      (f) =>
        f.primary &&
        f.kind === "CROSS" &&
        f.result.evidence[0]?.field === "loanRate" &&
        /신용/.test(f.title),
    );
    expect(credit?.result).toMatchObject({
      actual: 7.5,
      expected: 6.5,
      difference: 1,
      status: "확인 필요",
    });
    const student = findings.find(
      (f) =>
        f.primary &&
        f.kind === "CROSS" &&
        f.result.evidence[0]?.field === "loanBalance" &&
        /학자금/.test(f.title),
    );
    expect(Math.abs(student!.result.difference!)).toBe(15000);
    for (const field of ["totalAssets", "netAssets", "surplus"])
      expect(
        findings.some(
          (f) =>
            f.kind === "CROSS" &&
            f.result.evidence[0]?.field === field &&
            f.signal === "수치 차이",
        ),
      ).toBe(true);
    expect(
      findings.every(
        (f) =>
          !f.approved && ["확인 필요", "검증 불가"].includes(f.result.status),
      ),
    ).toBe(true);
    expect(
      findings
        .filter((f) => f.kind === "PLAN")
        .every(
          (f) =>
            f.questions.length &&
            ((f.result.references?.length ?? 0) > 0 ||
              f.result.evidence.length),
        ),
    ).toBe(true);
    expect(credit!.questions.some((q) => /기준일|시나리오/.test(q))).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  },
  15000,
);
