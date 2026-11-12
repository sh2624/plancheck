import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { feedbackFiles } from './feedback-fixtures';
import { parseXlsx } from '../src/parsers/xlsx';
import { parseDocx } from '../src/parsers/docx';
import { extractWorkbook, extractWord } from '../src/normalization/extract';
import { inspectDocuments } from '../src/inspection/analyze';
import { emptyPlanning } from '../src/planning/types';

it('헤더 단위의 재현 구조에서 월 잉여금·총자산 자동 발견과 정상 대조를 측정한다', async () => {
  const metrics = [];
  for (const assets of [false, true])
    for (const correct of [false, true]) {
      const files = await feedbackFiles({ assets, correct });
      const items = [
        ...extractWorkbook(await parseXlsx(files.xlsx, 'feedback.xlsx')),
        ...extractWord(await parseDocx(files.docx, 'feedback.docx')),
      ];
      const findings = inspectDocuments({ items, links: [], calculations: [], planning: emptyPlanning(), references: [] });
      const field = assets ? 'totalAssets' : 'surplus',
        code = assets ? 'CALC_ASSETS' : 'CALC_SURPLUS';
      const calculation = findings.find(
        (f) => f.result.code === code && f.result.evidence.some((c) => c.source === 'XLSX' && c.field === field),
      );
      const cross = findings.find((f) => f.kind === 'CROSS' && f.result.evidence.every((c) => c.field === field));
      metrics.push({
        case: field,
        correct,
        detected: calculation?.signal === '수치 차이',
        difference: calculation?.result.difference ?? null,
        crossDifference: cross?.result.difference ?? null,
        units: items.filter((c) => c.field === field).map((c) => c.unit),
        confirmedErrors: findings.filter((f) => f.approved?.status === '오류').length,
      });
      if (!process.env.PLANCHECK_FEEDBACK_BASELINE) {
        expect(calculation?.result.difference).toBe(correct ? 0 : assets ? -200000 : -20000);
        expect(cross?.result.difference).toBe(correct ? 0 : assets ? -200000 : -20000);
        expect(findings.every((f) => !f.approved)).toBe(true);
      }
    }
  mkdirSync('test-results', { recursive: true });
  writeFileSync(
    `test-results/feedback-${process.env.PLANCHECK_FEEDBACK_BASELINE ? 'before' : 'after'}.json`,
    JSON.stringify(metrics, null, 2),
  );
  expect(metrics).toHaveLength(4);
});
