import { it, expect } from 'vitest';
import JSZip from 'jszip';
import { feedbackWorkbook, feedbackWord, type FeedbackRow } from './feedback-fixtures';
import { parseXlsx } from '../src/parsers/xlsx';
import { parseDocx } from '../src/parsers/docx';
import { extractWorkbook, extractWord } from '../src/normalization/extract';
import { recommend } from '../src/recommendations/recommend';
import { emptyPlanning } from '../src/planning/types';
import { discoverCalculation, discoverCross, validateCalculation, validateCross } from '../src/validation/engine';
import { newCalculation } from '../src/validation/types';
import { suggestLinks } from '../src/normalization/links';
import { editCandidate } from '../src/normalization/values';
const workbook = async (rows: FeedbackRow[]) => extractWorkbook(await parseXlsx(await feedbackWorkbook(rows), 'repro.xlsx'));
const table = async (rows: FeedbackRow[]) => extractWord(await parseDocx(await feedbackWord(rows), 'repro.docx'));
/** 실제 OOXML 문단 경로를 거치는 비식별 재현 문서를 만든다. */
async function prose(text: string) {
  const z = new JSZip();
  z.file(
    'word/document.xml',
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return extractWord(await parseDocx(await z.generateAsync({ type: 'arraybuffer' }), 'repro.docx'));
}
it.each([
  ['23,000만 원', 230000000],
  ['2억 3,000만 원', 230000000],
  ['1억 5,000만 원', 150000000],
  ['1억 원', 100000000],
  ['3,500만 원', 35000000],
  ['2억 500만 원', 205000000],
] as const)('본문·표의 %s를 하나의 금액으로 보존한다', async (raw, value) => {
  for (const items of [
    await prose(`총자산은 ${raw}이다.`),
    await table([
      ['항목', '금액(만원)'],
      ['총자산', raw],
    ]),
  ]) {
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ normalizedValue: value, confirmed: false, field: 'totalAssets' });
    expect(items[0].originalText).toContain(raw);
    expect(items[0].location).toMatch(/문단|표/);
  }
});
it('복합 금액의 부호·잘못된 하위단위·날짜·금리·수량을 보수적으로 처리한다', async () => {
  expect((await prose('순자산 -1억 500만 원'))[0].normalizedValue).toBe(-105000000);
  expect((await prose('총자산 2억 30,00만 원'))[0].normalizedValue).toBeNull();
  expect((await prose('총자산 2억 15,000만 원'))[0].normalizedValue).toBeNull();
  expect(await prose('총자산 기준일 2026년 11월 13일, 24개월, 3개, 4%')).toHaveLength(0);
});
it('같은 행의 동등한 단위 열은 원본 두 개와 계산 제외 근거를 보존한다', async () => {
  const items = await workbook([
    ['항목', '금액(만원)', '금액(억원)'],
    ['예금', 15000, 1.5],
    ['총자산', 15000, 1.5],
  ]);
  expect(items).toHaveLength(4);
  expect(items.slice(0, 2).map((c) => c.normalizedValue)).toEqual([150000000, 150000000]);
  const rec = recommend(items, [], emptyPlanning(), []).find((r) => r.calculation)!;
  expect(rec.calculation!.groups.parts).toHaveLength(1);
  expect(rec.risks.join(' ')).toContain('한 번만 계산');
  expect(rec.references).toHaveLength(4);
  const result = discoverCalculation(items, rec.calculation!);
  expect(result).toMatchObject({ expected: 150000000, difference: 0 });
  const manual = newCalculation('assets', 'manual');
  manual.targetId = items[2].id;
  manual.groups.parts = items.slice(0, 2).map((c) => c.id);
  expect(discoverCalculation(items, manual).expected).toBe(150000000);
  const missing = { ...manual, groups: { ...manual.groups, parts: [...manual.groups.parts, 'missing-source'] } };
  expect(discoverCalculation(items, missing).expected).toBeNull();
  const repeated = { ...manual, groups: { ...manual.groups, parts: [...manual.groups.parts, manual.groups.parts[0]] } };
  expect(discoverCalculation(items, repeated).needs.join(' ')).toContain('중복 선택');
  expect(items.every((c) => !c.confirmed && !c.excluded)).toBe(true);
});
it('다른 금액 역할과 같은 단위의 별개 열을 중복으로 제거하지 않는다', async () => {
  const items = await workbook([
    ['항목', '잔액(만원)', '월 납입액(만원)'],
    ['IRP', 700, 20],
  ]);
  expect(items.map((c) => c.field)).toEqual(['pension', 'savings']);
  expect(items.every((c) => !c.representation)).toBe(true);
  const separate = await workbook([
    ['항목', '금액(만원)', '금액(만원)'],
    ['예금', 100, 200],
  ]);
  expect(separate.every((c) => !c.representation)).toBe(true);
});
it.each([
  [
    'debt',
    [
      ['신용대출 잔액', 4200, 0.42],
      ['총부채', 4200, 0.42],
    ],
  ],
  [
    'net',
    [
      ['총자산', 10000, 1],
      ['총부채', 4200, 0.42],
      ['순자산', 5800, 0.58],
    ],
  ],
  [
    'surplus',
    [
      ['월 소득', 400, 0.04],
      ['월 지출', 300, 0.03],
      ['월 저축·투자', 50, 0.005],
      ['월 잉여금', 50, 0.005],
    ],
  ],
] as const)('%s 계산도 동등한 단위 열을 한 번만 반영한다', async (rule, rows) => {
  const items = await workbook([['항목', '금액(만원)', '금액(억원)'], ...rows.map((r) => [...r])]);
  const rec = recommend(items, [], emptyPlanning(), []).find((r) => r.calculation?.rule === rule)!;
  expect(discoverCalculation(items, rec.calculation!).difference).toBe(0);
  expect(items.every((c) => !c.confirmed)).toBe(true);
});
it('동일 행의 단위 환산값이 다르거나 편집되면 대표를 임의 선택하지 않는다', async () => {
  const items = await workbook([
    ['항목', '금액(만원)', '금액(억원)'],
    ['예금', 15000, 1.6],
    ['총자산', 15000, 1.5],
  ]);
  const rec = recommend(items, [], emptyPlanning(), []).find((r) => r.calculation)!;
  expect(rec.scopeIssues?.join(' ')).toContain('불일치');
  const spec = newCalculation('assets', 'conflict');
  spec.targetId = items[2].id;
  spec.groups.parts = items.slice(0, 2).map((c) => c.id);
  expect(discoverCalculation(items, spec).expected).toBeNull();
  const edited = items.map((c, i) => (i === 1 ? editCandidate(c, { number: '1.5' }) : c));
  expect(discoverCalculation(edited, spec).expected).toBe(150000000);
  const differentStatus = edited.map((c, i) => (i === 1 ? editCandidate(c, { certainty: '조건부' }) : c));
  expect(discoverCalculation(differentStatus, spec).expected).toBeNull();
  expect(validateCalculation(edited, spec).status).not.toBe('오류');
});
it.each([
  ['입출금통장', 'deposit'],
  ['CMA', 'deposit'],
  ['연금저축', 'pension'],
  ['IRP', 'pension'],
  ['신용카드 미결제액', 'loanBalance'],
] as const)('%s의 잔액 분류를 본문·표·Excel에서 유지한다', async (name, field) => {
  for (const items of [
    await prose(`${name} 잔액 740만 원`),
    await table([
      ['항목', '금액(만원)'],
      [name, 740],
    ]),
    await workbook([
      ['항목', '금액(만원)'],
      [name, 740],
    ]),
  ])
    expect(items[0]).toMatchObject({ field, normalizedValue: 7400000, confirmed: false });
});
it('금융상품의 보유액·납입액·지출액은 별개 의미로 유지한다', async () => {
  expect((await prose('연금저축 월 납입액 17만 원'))[0]).toMatchObject({ field: 'savings', period: '월간' });
  expect((await prose('CMA 지출액 43만 원'))[0].field).toBe('variableExpense');
  expect((await prose('CMA 월 이체액 43만 원'))[0]).toMatchObject({ field: 'unknown', normalizedValue: 430000, confirmed: false });
  const a = await workbook([
      ['항목', '금액(만원)'],
      ['입출금통장', 740],
    ]),
    b = await table([
      ['항목', '금액(만원)'],
      ['예금', 740],
    ]);
  expect(suggestLinks([...a, ...b], [])).toHaveLength(0);
});
it.each([
  ['월 잉여금', '월간'],
  ['월간 순현금흐름', '월간'],
  ['연간 순현금흐름', '연간'],
  ['연간 저축액', '연간'],
  ['월 소득', '월간'],
  ['연 소득', '연간'],
  ['연간 원리금 상환액', '연간'],
] as const)('%s의 기간을 금액과 별개로 보존한다', async (label, period) => {
  const items = await table([
    ['항목', '금액(만원)'],
    [label, 54],
  ]);
  expect(items[0].period).toBe(period);
});
it('명시적 반복 월·연 소득은 연간 기준으로 비교하되 원본과 승인 상태를 유지한다', async () => {
  const a = await workbook([
      ['항목', '월 금액(만원)'],
      ['매월 근로소득', 390],
    ]),
    b = await table([
      ['항목', '연간금액(만원)'],
      ['매월 근로소득', 4680],
    ]);
  const items = [...a, ...b],
    links = [{ id: 'l', xlsxId: a[0].id, docxId: b[0].id }];
  const result = discoverCross(items, links)[0];
  expect(result).toMatchObject({ actual: 46800000, expected: 46800000, difference: 0 });
  expect(result.basis).toContain('× 12');
  expect(a[0].normalizedValue).toBe(3900000);
  expect(validateCross(items, links)[0].status).not.toBe('검증 통과');
  b[0].originalText += ' 일회성 특별 상여';
  const oneOff = discoverCross(items, links)[0];
  expect(oneOff.actual).toBe(3900000);
  expect(oneOff.needs.join(' ')).toContain('기간');
  expect(oneOff.basis).not.toContain('× 12');
});
