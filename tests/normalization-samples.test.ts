import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseDocx } from "../src/parsers/docx";
import { parseXlsx } from "../src/parsers/xlsx";
import { extractWorkbook, extractWord } from "../src/normalization/extract";
it.skipIf(!process.env.PLANCHECK_XLSX || !process.env.PLANCHECK_DOCX)(
  "실제 샘플의 필수 재무 후보를 추출한다",
  async () => {
    const buf = (p: string) => {
      const b = readFileSync(p);
      return b.buffer.slice(
        b.byteOffset,
        b.byteOffset + b.byteLength,
      ) as ArrayBuffer;
    };
    const x = extractWorkbook(
      await parseXlsx(buf(process.env.PLANCHECK_XLSX!), "sample.xlsx"),
    );
    const d = extractWord(
      await parseDocx(buf(process.env.PLANCHECK_DOCX!), "sample.docx"),
    );
    for (const [source, items] of [
      ["XLSX", x],
      ["DOCX", d],
    ] as const) {
      for (const field of [
        "income",
        "deposit",
        "totalAssets",
        "totalDebt",
        "loanRate",
        "loanBalance",
        "surplus",
      ]) {
        const matches = items.filter((c) => c.field === field);
        expect(matches.length, `${source} ${field}`).toBeGreaterThan(0);
      }
      expect(
        items.some(
          (c) => c.field === "income" && c.normalizedValue === 3150000,
        ),
      ).toBe(true);
      expect(
        items.some(
          (c) =>
            c.field === "loanRate" && /신용/.test(c.label) && c.unit === "%",
        ),
      ).toBe(true);
      expect(
        items.some((c) => c.field === "loanBalance" && /학자금/.test(c.label)),
      ).toBe(true);
      expect(new Set(items.map((c) => c.id)).size).toBe(items.length);
      const expected =
        source === "XLSX"
          ? {
              totalAssets: 20700000,
              totalDebt: 12000000,
              loanRate: 7.5,
              loanBalance: 7000000,
              surplus: 46020,
            }
          : {
              totalAssets: 30900000,
              totalDebt: 12094000,
              loanRate: 6.5,
              loanBalance: 7015000,
              surplus: 70000,
            };
      for (const [field, value] of Object.entries(expected)) {
        expect(
          items.some(
            (c) =>
              c.field === field &&
              c.normalizedValue === value &&
              (field !== "loanRate" || /신용/.test(c.label)) &&
              (field !== "loanBalance" || /학자금/.test(c.label)),
          ),
          `${source} ${field} 값`,
        ).toBe(true);
      }
      expect(items.some((c) => c.field === "pension")).toBe(true);
      expect(
        items.every((c) => !c.confirmed && c.originalText && c.location),
      ).toBe(true);
    }
  },
);
