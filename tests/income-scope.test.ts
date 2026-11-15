import { expect, it } from 'vitest';
import { item } from './validation-fixtures';
import { assessRelationship } from '../src/normalization/relationships';
import { suggestLinks } from '../src/normalization/links';
import { inspectDocuments } from '../src/inspection/analyze';
import { reviewQuality } from '../src/inspection/quality';
import { emptyPlanning } from '../src/planning/types';
import { feedbackWorkbook, feedbackWord } from './feedback-fixtures';
import { parseXlsx } from '../src/parsers/xlsx';
import { parseDocx } from '../src/parsers/docx';
import { extractWorkbook, extractWord } from '../src/normalization/extract';

it.each([
  ['남편 월 실수령 소득', '부부 합산 실수령 소득 (남편 420 + 아내 280)'],
  ['아내 월 실수령 소득', '수입 합계 · 부부 합산 실수령 소득'],
  ['남편 월 소득', '아내 월 소득'],
  ['본인 월 소득', '가구 월 소득'],
  ['배우자 월 소득', '월 수입 합계'],
])('서로 다른 소득 범위를 차이 후보에서 제외한다: %s / %s', (aLabel, bLabel) => {
  const a = item('a', 'income', 4200000, { label: aLabel, confirmed: false });
  const b = item('b', 'income', 7000000, { label: bLabel, source: 'DOCX', confirmed: false });
  expect(assessRelationship(a, b).blocked).toBe(true);
  expect(suggestLinks([a, b], [])).toHaveLength(0);
  const entries = reviewQuality(
    inspectDocuments({ items: [a, b], links: [], calculations: [], references: [], planning: emptyPlanning() }),
  );
  const records = entries.filter((e) => e.finding.kind === 'CROSS');
  expect(records.length).toBeGreaterThan(0);
  for (const record of records) {
    expect(record.tier).toBe('상세 분석 기록');
    expect(record.finding.result.difference).toBeNull();
    expect(record.finding.result.evidence).toHaveLength(2);
  }
});

it.each([
  ['남편 월 실수령 소득', '남편 월 소득'],
  ['아내 월 실수령 소득', '아내 월 소득'],
  ['부부 월 실수령액', '수입 합계 · 부부 합산 실수령 소득 (남편 400 + 아내 300)'],
])('같은 대상의 실제 소득 차이는 유지한다: %s / %s', (aLabel, bLabel) => {
  const a = item('a', 'income', 7000000, { label: aLabel, confirmed: false });
  const b = item('b', 'income', 7100000, { label: bLabel, source: 'DOCX', confirmed: false });
  expect(assessRelationship(a, b).blocked).toBe(false);
  expect(suggestLinks([a, b], [])).toHaveLength(1);
  const findings = inspectDocuments({ items: [a, b], links: [], calculations: [], references: [], planning: emptyPlanning() });
  const cross = findings.find((f) => f.kind === 'CROSS')!;
  expect(Math.abs(cross.result.difference!)).toBe(100000);
  expect(cross.result.status).not.toBe('오류');
});

it('실제 파서 경로에서 개인 소득은 합산 소득에 자동 연결하지 않는다', async () => {
  const x = extractWorkbook(
    await parseXlsx(
      await feedbackWorkbook([
        ['항목', '월간(만원)', '연간(만원)'],
        ['남편 월 실수령 소득', 420, 5040],
        ['아내 월 실수령 소득', 280, 3360],
        ['부부 합산 실수령 소득', 700, 8400],
      ]),
      'scope.xlsx',
    ),
  );
  const w = extractWord(
    await parseDocx(
      await feedbackWord([
        ['항목', '월간(만원)', '연간(만원)'],
        ['부부 합산 실수령 소득 (남편 420 + 아내 280)', 700, 8400],
      ]),
      'scope.docx',
    ),
  );
  const links = suggestLinks([...x, ...w], []);
  expect(links.length).toBeGreaterThan(0);
  expect(links.every((l) => x.find((c) => c.id === l.xlsxId)?.label.includes('합산'))).toBe(true);
});
