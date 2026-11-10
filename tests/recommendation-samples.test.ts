import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
import { parseXlsx } from "../src/parsers/xlsx";
import { parseDocx } from "../src/parsers/docx";
import { extractWorkbook, extractWord } from "../src/normalization/extract";
import {
  workbookReferences,
  wordReferences,
  extractPlanning,
} from "../src/planning/extract";
import { emptyPlanning } from "../src/planning/types";
import { recommend, loanIdentity } from "../src/recommendations/recommend";
import { applyRecommendation } from "../src/recommendations/apply";
import { validateAll } from "../src/validation/engine";
it.skipIf(!process.env.PLANCHECK_XLSX || !process.env.PLANCHECK_DOCX)(
  "실제 샘플의 소득·금리·학자금 잔액과 계산을 값 하드코딩 없이 추천한다",
  async () => {
    const bytes = (p: string) => {
      const b = readFileSync(p);
      return b.buffer.slice(
        b.byteOffset,
        b.byteOffset + b.byteLength,
      ) as ArrayBuffer;
    };
    const x = await parseXlsx(
        bytes(process.env.PLANCHECK_XLSX!),
        "financial.xlsx",
      ),
      d = await parseDocx(bytes(process.env.PLANCHECK_DOCX!), "report.docx");
    const items = [...extractWorkbook(x), ...extractWord(d)],
      references = [...workbookReferences(x), ...wordReferences(d)];
    const planning = { ...emptyPlanning(), ...extractPlanning(references) },
      before = JSON.stringify(items),
      recommendations = recommend(items, [], planning, references);
    expect(JSON.stringify(items)).toBe(before);
    expect(items.every((c) => !c.confirmed)).toBe(true);
    for (const rule of ["assets", "debt", "net", "surplus", "loan"])
      expect(recommendations.some((r) => r.calculation?.rule === rule)).toBe(
        true,
      );
    for (const field of ["income", "loanRate", "loanBalance"]) {
      const r = recommendations.find(
        (r) =>
          r.primary &&
          r.kind === "CROSS" &&
          items.find((c) => c.id === r.candidateIds[0])?.field === field &&
          (field === "loanRate"
            ? loanIdentity(
                items.find((c) => c.id === r.candidateIds[0])!,
              ).includes("신용")
            : field === "loanBalance"
              ? loanIdentity(
                  items.find((c) => c.id === r.candidateIds[0])!,
                ).includes("학자금")
              : true),
      )!;
      expect(r).toBeTruthy();
      const pair = items.filter((c) => r.candidateIds.includes(c.id));
      expect(pair).toHaveLength(2);
      const original = applyRecommendation(
        { items, links: [], calculations: [] },
        r,
        true,
      );
      expect(validateAll(original.items, original.links, [])[0].status).toBe(
        "확인 필요",
      );
      const verified = items.map((c) =>
        r.candidateIds.includes(c.id)
          ? {
              ...c,
              asOf: "2026-10-31",
              scenario: "사용자가 원문을 대조한 동일 기준",
              certainty: "확정" as const,
            }
          : c,
      );
      const approved = applyRecommendation(
          { items: verified, links: [], calculations: [] },
          r,
          true,
        ),
        result = validateAll(approved.items, approved.links, [])[0];
      expect(approved.items.filter((c) => c.confirmed)).toHaveLength(2);
      expect(result.status).toBe(field === "income" ? "검증 통과" : "오류");
      expect(result.difference).toBe(
        field === "income" ? 0 : field === "loanRate" ? 1 : -15000,
      );
      expect(pair.map((c) => c.normalizedValue)).toEqual(
        verified
          .filter((c) => r.candidateIds.includes(c.id))
          .map((c) => c.normalizedValue),
      );
    }
    expect(
      recommendations
        .filter((r) => r.kind === "PLAN")
        .every((r) => r.planFocus),
    ).toBe(true);
    expect(
      planning.funds.every((f) => f.approval === "미확인" && !f.confirmed),
    ).toBe(true);
    console.log(
      JSON.stringify({
        recommendations: recommendations.length,
        core: recommendations.filter((r) => r.primary).length,
        CALC: recommendations.filter((r) => r.kind === "CALC").length,
        CROSS: recommendations.filter((r) => r.kind === "CROSS").length,
        ALLOC: recommendations.filter((r) => r.kind === "ALLOC").length,
        PLAN: recommendations.filter((r) => r.kind === "PLAN").length,
      }),
    );
  },
);
