import { it, expect } from 'vitest';
import { item } from './validation-fixtures';
import { inspectDocuments } from '../src/inspection/analyze';
import { emptyPlanning } from '../src/planning/types';
import { reviewQuality } from '../src/inspection/quality';
import { groupDiscoveries } from '../src/presentation/discoveries';
import type { ReviewedFinding } from '../src/presentation/findingGroups';
/** 임의 금액의 원본 항목으로 실제 추천·검증 경로의 두 순자산 산식을 만든다. */
function records(): ReviewedFinding[] {
  const items = (['XLSX', 'DOCX'] as const).flatMap((source, side) => {
    const assets = side ? 87000000 : 81000000,
      debt = 24000000;
    return (['totalAssets', 'totalDebt', 'netAssets'] as const).map((field, n) =>
      item(`${source}-${field}`, field, field === 'totalAssets' ? assets : field === 'totalDebt' ? debt : assets - debt, {
        source,
        fileName: source === 'XLSX' ? 'test.xlsx' : 'test.docx',
        location: source === 'XLSX' ? `시트!B${n + 1}` : `본문 표 1 · ${n + 1}행`,
        confirmed: false,
        certainty: '미확인',
        asOf: side ? '2031-04-03' : '',
        scenario: '',
      }),
    );
  });
  return inspectDocuments({ items, references: [], links: [], calculations: [], planning: emptyPlanning() });
}
const groupOf = (groups: ReturnType<typeof groupDiscoveries>, field: string) =>
  groups.find((g) => g.members.some((e) => e.finding.kind === 'CROSS' && e.finding.result.evidence[0]?.field === field));
it('동일 원본의 두 순자산 산식과 부채 일치로 입증한 파생 차이만 묶는다', () => {
  const findings = records(),
    before = JSON.stringify(findings),
    groups = groupDiscoveries(reviewQuality(findings));
  const assets = groupOf(groups, 'totalAssets');
  expect(assets).toBe(groupOf(groups, 'netAssets'));
  expect(assets?.explanation).toContain('순자산 = 총자산 − 총부채');
  expect(assets?.members.map((e) => e.finding.result.evidence[0]?.field)).toContain('netAssets');
  expect(JSON.stringify(findings)).toBe(before);
  expect(findings.every((f) => !f.approved)).toBe(true);
});
it.each([
  'missing-proof',
  'wrong-id',
  'different-date',
  'different-scenario',
  'different-file',
  'different-period',
  'different-debt',
  'unknown-reply',
])('차이가 같아도 인과 근거가 없으면 별도로 유지한다: %s', (kind) => {
  let findings = records();
  const proof = findings.find((f) => f.result.code === 'CALC_NET' && f.result.evidence[0]?.source === 'DOCX')!;
  if (kind === 'missing-proof') findings = findings.filter((f) => f !== proof);
  if (kind === 'wrong-id') proof.recommendation!.calculation!.groups.assets = ['unrelated-source'];
  if (kind === 'different-date') proof.result.evidence = proof.result.evidence.map((c, i) => (i ? { ...c, asOf: '2032-01-01' } : c));
  if (kind === 'different-scenario') proof.result.evidence = proof.result.evidence.map((c, i) => (i ? { ...c, scenario: '대안' } : c));
  if (kind === 'different-file') proof.result.evidence = proof.result.evidence.map((c, i) => (i ? { ...c, fileName: 'other.docx' } : c));
  if (kind === 'different-period') proof.result.evidence = proof.result.evidence.map((c, i) => (i ? { ...c, period: '1년 후' } : c));
  if (kind === 'different-debt')
    proof.result.evidence = proof.result.evidence.map((c) => (c.field === 'totalDebt' ? { ...c, normalizedValue: 26000000 } : c));
  if (kind === 'unknown-reply') proof.decision = { choice: 'unknown', candidateIds: [], fingerprint: '' };
  const groups = groupDiscoveries(reviewQuality(findings));
  expect(groupOf(groups, 'totalAssets')).not.toBe(groupOf(groups, 'netAssets'));
});
