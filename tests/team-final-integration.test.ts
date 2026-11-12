import { expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseXlsx } from '../src/parsers/xlsx';
import { parseDocx } from '../src/parsers/docx';
import { extractWorkbook, extractWord } from '../src/normalization/extract';
import { extractPlanning, workbookReferences, wordReferences } from '../src/planning/extract';
import { emptyPlanning } from '../src/planning/types';
import { inspectDocuments } from '../src/inspection/analyze';
import { groupDiscoveries } from '../src/presentation/discoveries';
import { reviewQuality } from '../src/inspection/quality';

it.skipIf(!process.env.PLANCHECK_TEAM_XLSX || !process.env.PLANCHECK_TEAM_DOCX)(
  '실제 팀원 원본의 다섯 검토 대상을 개별 평가하고 확정 오류와 구분한다',
  async () => {
    const x = readFileSync(process.env.PLANCHECK_TEAM_XLSX!),
      d = readFileSync(process.env.PLANCHECK_TEAM_DOCX!);
    const buffer = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    const book = await parseXlsx(buffer(x), 'team.xlsx'),
      doc = await parseDocx(buffer(d), 'team.docx');
    const items = [...extractWorkbook(book), ...extractWord(doc)],
      references = [...workbookReferences(book), ...wordReferences(doc)];
    const planning = { ...emptyPlanning(), ...extractPlanning(references) };
    const input = { items, references, planning, links: [], calculations: [] },
      findings = inspectDocuments(input);
    const cases = [
      {
        kind: 'surplus',
        finding: findings.find(
          (f) => f.kind === 'CROSS' && f.result.evidence[0]?.field === 'surplus' && Math.abs(f.result.difference ?? 0) === 20000,
        ),
      },
      {
        kind: 'assets',
        finding: findings.find(
          (f) => f.kind === 'CROSS' && f.result.evidence[0]?.field === 'totalAssets' && Math.abs(f.result.difference ?? 0) === 200000,
        ),
      },
      {
        kind: 'allocation',
        finding: findings.find(
          (f) => f.kind === 'ALLOC' && f.result.reviewHint && f.result.actual === 8900000 && f.result.difference === 3000000,
        ),
      },
      {
        kind: 'conditional',
        finding: findings.find((f) => f.result.code === 'PLAN_CONDITIONAL' && f.result.reviewHint && f.result.actual === 1320000),
      },
      {
        kind: 'action',
        finding: findings.find(
          (f) => f.result.code === 'PLAN_CONFLICT' && f.result.reviewHint && f.result.references?.some((r) => /ETF/.test(r.originalText)),
        ),
      },
    ];
    expect(cases.every((c) => !!c.finding)).toBe(true);
    expect(findings.every((f) => !f.approved && f.result.status !== '오류' && f.result.status !== '검증 통과')).toBe(true);
    expect(items.every((c) => !c.confirmed)).toBe(true);
    expect(planning.actions.map((a) => a.targetId)).not.toContain('원');
    expect(planning.actions.map((a) => [a.targetId, a.amount, a.action])).toEqual([
      ['ETF', '15', '중단'],
      ['ETF', '15', '유지'],
    ]);
    expect(planning.funds.find((r) => /정부기여금/.test(r.label))?.amount).toBe('');
    expect(cases[3].finding!.result.basis).toContain('1년 후');
    for (const c of cases) for (const ref of c.finding!.result.references ?? []) expect(references).toContainEqual(ref);
    const off = inspectDocuments({ ...input, compoundDiscovery: false });
    expect(off.every((f) => !f.result.reviewHint)).toBe(true);
    expect(off.some((f) => f.kind === 'CROSS' && Math.abs(f.result.difference ?? 0) === 20000)).toBe(true);
    const groups = groupDiscoveries(reviewQuality(findings));
    mkdirSync('.cache/final-evaluation', { recursive: true });
    writeFileSync(
      '.cache/final-evaluation/team-final-evaluation.json',
      JSON.stringify(
        {
          automaticReviewTargets: cases.filter((c) => c.finding).length,
          approvedErrors: 0,
          engineRecords: findings.length,
          representativeDiscoveries: groups.length,
          cases: cases.map((c) => ({
            kind: c.kind,
            automatic: true,
            reviewOperationsForDiscovery: 0,
            approved: false,
            status: c.finding!.result.status,
            actual: c.finding!.result.actual,
            expected: c.finding!.result.expected,
            difference: c.finding!.result.difference,
            sourceLocations: [...c.finding!.result.evidence, ...(c.finding!.result.references ?? [])].map((r) => r.location),
            needs: c.finding!.result.needs,
          })),
          fileHashes: [x, d].map((b) => createHash('sha256').update(b).digest('hex')),
        },
        null,
        2,
      ),
    );
    expect(readFileSync(process.env.PLANCHECK_TEAM_XLSX!).equals(x)).toBe(true);
    expect(readFileSync(process.env.PLANCHECK_TEAM_DOCX!).equals(d)).toBe(true);
  },
);
