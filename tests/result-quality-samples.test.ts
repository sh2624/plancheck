import { reviewQuality, exactFindingKey } from "../src/inspection/quality";
import { it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseXlsx } from "../src/parsers/xlsx";
import { parseDocx } from "../src/parsers/docx";
import { extractWorkbook, extractWord } from "../src/normalization/extract";
import {
  workbookReferences,
  wordReferences,
  extractPlanning,
} from "../src/planning/extract";
import { emptyPlanning } from "../src/planning/types";
import { inspectDocuments } from "../src/inspection/analyze";
import {
  groupFindings,
  findingSection,
} from "../src/presentation/findingGroups";
it.skipIf(!process.env.PLANCHECK_XLSX || !process.env.PLANCHECK_DOCX)(
  "실제 결과의 유형·보류 원인·공유 원본·관계별 품질을 집계한다",
  async () => {
    const bytes = (path: string) => {
      const b = readFileSync(path);
      return b.buffer.slice(
        b.byteOffset,
        b.byteOffset + b.byteLength,
      ) as ArrayBuffer;
    };
    const x = await parseXlsx(bytes(process.env.PLANCHECK_XLSX!), "input.xlsx"),
      d = await parseDocx(bytes(process.env.PLANCHECK_DOCX!), "input.docx");
    const xr = workbookReferences(x),
      dr = wordReferences(d),
      xp = extractPlanning(xr),
      dp = extractPlanning(dr),
      items = [...extractWorkbook(x), ...extractWord(d)];
    const input = {
      items,
      links: [],
      calculations: [],
      references: [...xr, ...dr],
      planning: {
        ...emptyPlanning(),
        funds: [...xp.funds, ...dp.funds],
        actions: [...xp.actions, ...dp.actions],
      },
    };
    const before = JSON.stringify(input),
      findings = inspectDocuments(input);
    const count = (values: string[]) =>
      Object.fromEntries(
        [...new Set(values)].map((key) => [
          key,
          values.filter((x) => x === key).length,
        ]),
      );
    const groups = groupFindings(findings);
    const quality = reviewQuality(findings);
    const metrics = {
      total: findings.length,
      quality: {
        tiers: count(quality.map((e) => e.tier)),
        unique: quality.length,
        duplicates:
          findings.length - new Set(findings.map(exactFindingKey)).size,
        blocked: findings.filter((f) => f.relationship?.blocked).length,
        contextConflict: findings.filter(
          (f) =>
            f.relationship &&
            (f.relationship.periodConflict ||
              f.relationship.dateConflict ||
              f.relationship.scenarioConflict),
        ).length,
        primary: quality
          .filter((e) => e.tier === "우선 검토")
          .map((e) => ({
            title: e.finding.title,
            field: e.finding.result.evidence[0]?.field,
            supportCount: e.supportCount,
            reasons: e.reasons,
          })),
        additional: quality
          .filter((e) => e.tier === "추가 검토")
          .map((e) => ({
            title: e.finding.title,
            pair: e.finding.result.evidence.map((c) => c.label),
            reason: e.reasons,
          })),
        recordReasons: count(
          quality
            .filter((e) => e.tier === "상세 분석 기록")
            .map((e) => e.reasons[0]),
        ),
      },
      composition: count(
        findings.map((f) => `${findingSection(f)} / ${f.result.code}`),
      ),
      calculations: findings
        .filter((f) => f.kind === "CALC")
        .map((f) => ({
          status: f.result.status,
          actual: f.result.actual,
          expected: f.result.expected,
          evidence: f.result.evidence.map((c) => ({
            label: c.label,
            number: c.number,
            unit: c.unit,
            period: c.period,
            location: c.location,
          })),
          basis: f.result.basis,
          needs: f.result.needs,
        })),
      kinds: count(findings.map((f) => f.kind)),
      sections: count(findings.map((f) => findingSection(f))),
      byField: count(
        findings
          .filter((f) => f.kind === "CROSS")
          .map((f) => f.result.evidence[0]?.field ?? "unknown"),
      ),
      signals: count(findings.map((f) => f.signal)),
      needs: count(findings.flatMap((f) => f.result.needs)),
      groups: groups.map((g) => ({
        section: g.section,
        count: g.count,
        groups: g.groups.length,
        derived: g.count - g.groups.length,
      })),
      primary: findings
        .filter((f) => f.primary)
        .map((f) => ({
          kind: f.kind,
          field: f.result.evidence[0]?.field,
          signal: f.signal,
          title: f.title,
        })),
      pairs: findings
        .filter((f) => f.kind === "CROSS")
        .map((f) => ({
          id: f.id,
          field: f.result.evidence[0].field,
          primary: f.primary,
          signal: f.signal,
          evidence: f.result.evidence.map((c) => ({
            id: c.id,
            label: c.label,
            number: c.number,
            unit: c.unit,
            location: c.location,
            asOf: c.asOf,
            period: c.period,
            scenario: c.scenario,
            certainty: c.certainty,
            originalText: c.originalText,
          })),
        })),
    };
    if (process.env.PLANCHECK_QUALITY_AUDIT) {
      mkdirSync("test-results", { recursive: true });
      writeFileSync(
        `test-results/quality-${process.env.PLANCHECK_QUALITY_AUDIT === "baseline" ? "baseline" : "after"}.json`,
        JSON.stringify(metrics, null, 2),
      );
    }
    expect(findings.length).toBeGreaterThan(0);
    const priority = quality.filter((e) => e.tier === "우선 검토");
    for (const field of [
      "loanRate",
      "loanBalance",
      "surplus",
      "totalAssets",
      "totalDebt",
      "netAssets",
    ]) {
      expect(
        priority.some((e) => e.finding.result.evidence[0]?.field === field),
      ).toBe(true);
    }
    for (const finding of findings.filter((f) => f.relationship?.blocked)) {
      expect(finding.result.status).toBe("검증 불가");
      expect(finding.result.difference).toBeNull();
      expect(finding.recommendation).toBeUndefined();
      expect(
        finding.result.evidence.every((c) => c.location && c.originalText),
      ).toBe(true);
    }
    expect(quality.flatMap((e) => e.occurrences)).toHaveLength(findings.length);
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(findings.length);
    expect(JSON.stringify(input)).toBe(before);
  },
  15000,
);
