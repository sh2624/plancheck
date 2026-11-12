import { it, expect } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseXlsx } from '../src/parsers/xlsx';
import { parseDocx } from '../src/parsers/docx';
import { extractWorkbook, extractWord } from '../src/normalization/extract';
import { inspectDocuments } from '../src/inspection/analyze';
import { workbookReferences, wordReferences, extractPlanning } from '../src/planning/extract';
import { emptyPlanning } from '../src/planning/types';

it.skipIf(!process.env.PLANCHECK_TEAM_XLSX || !process.env.PLANCHECK_TEAM_DOCX)(
  '팀원 원본을 읽기 전용으로 검사하고 승인 없는 발견과 원본 위치를 보존한다',
  async () => {
    const originalX = readFileSync(process.env.PLANCHECK_TEAM_XLSX!),
      originalD = readFileSync(process.env.PLANCHECK_TEAM_DOCX!);
    const bytes = (path: string) => {
      const b = readFileSync(path);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    };
    const x = await parseXlsx(bytes(process.env.PLANCHECK_TEAM_XLSX!), 'team.xlsx'),
      d = await parseDocx(bytes(process.env.PLANCHECK_TEAM_DOCX!), 'team.docx');
    const xr = workbookReferences(x),
      dr = wordReferences(d),
      xp = extractPlanning(xr),
      dp = extractPlanning(dr);
    const items = [...extractWorkbook(x), ...extractWord(d)];
    const findings = inspectDocuments({
      items,
      links: [],
      calculations: [],
      references: [...xr, ...dr],
      planning: { ...emptyPlanning(), funds: [...xp.funds, ...dp.funds], actions: [...xp.actions, ...dp.actions] },
    });
    expect(findings.every((f) => !f.approved)).toBe(true);
    expect(items.every((c) => c.location && c.originalText && !c.confirmed)).toBe(true);
    for (const [field, difference] of [
      ['surplus', 20000],
      ['totalAssets', 200000],
    ] as const)
      expect(
        findings.some(
          (f) =>
            f.kind === 'CROSS' && f.result.evidence.every((c) => c.field === field) && Math.abs(f.result.difference ?? 0) === difference,
        ),
      ).toBe(true);
    expect(findings.find((f) => f.result.code === 'CALC_ASSETS' && f.result.evidence[0]?.source === 'XLSX')?.result.difference).toBe(0);
    const metrics = {
      items: items.map((c) => ({
        source: c.source,
        field: c.field,
        label: c.label,
        unit: c.unit,
        number: c.number,
        value: c.normalizedValue,
        location: c.location,
        period: c.period,
      })),
      findings: findings.map((f) => ({
        kind: f.kind,
        code: f.result.code,
        status: f.result.status,
        signal: f.signal,
        actual: f.result.actual,
        expected: f.result.expected,
        difference: f.result.difference,
        locations: f.result.evidence.map((c) => c.location),
        basis: f.result.basis,
        needs: f.result.needs,
      })),
      rows: [...xr, ...dr],
    };
    mkdirSync('test-results', { recursive: true });
    writeFileSync('test-results/team-feedback.json', JSON.stringify(metrics, null, 2));
    expect(readFileSync(process.env.PLANCHECK_TEAM_XLSX!).equals(originalX)).toBe(true);
    expect(readFileSync(process.env.PLANCHECK_TEAM_DOCX!).equals(originalD)).toBe(true);
  },
  15000,
);
