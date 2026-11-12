import { it, expect } from 'vitest';
import JSZip from 'jszip';
import { feedbackWorkbook, feedbackWord } from './feedback-fixtures';
import { parseXlsx } from '../src/parsers/xlsx';
import { parseDocx } from '../src/parsers/docx';
import { extractWorkbook, extractWord } from '../src/normalization/extract';
import { bulkUnitIds, unitRangeKey } from '../src/normalization/bulkUnits';
import { editCandidate } from '../src/normalization/values';
import { assessRelationship } from '../src/normalization/relationships';
import { extractPlanning } from '../src/planning/extract';
const x = async (rows: Parameters<typeof feedbackWorkbook>[0]) =>
  extractWorkbook(await parseXlsx(await feedbackWorkbook(rows), 'unit.xlsx'));
const d = async (rows: Parameters<typeof feedbackWord>[0]) => extractWord(await parseDocx(await feedbackWord(rows), 'unit.docx'));
it.each(['금액(만원)', '금액 (만 원)', '금액（만원）'])('%s 열 제목의 단위를 상속하고 확인 완료로 바꾸지 않는다', async (header) => {
  const items = await x([
    ['항목', header],
    ['월 소득', 427],
  ]);
  expect(items[0]).toMatchObject({ unit: '만 원', normalizedValue: 4270000, confirmed: false, period: '월간' });
  expect(items[0].unitEvidence?.locations).toContain('재무현황!B1');
});
it('셀의 명시 단위가 우선하고 상속 단위끼리 충돌하면 비운다', async () => {
  const items = await x([['단위: 만원'], ['항목', '금액(원)'], ['월 소득', 427], ['월 지출', '180원']]);
  expect(items[0]).toMatchObject({ unit: '미확인', normalizedValue: null });
  expect(items[0].unitEvidence?.level).toBe('conflict');
  expect(items[1]).toMatchObject({ unit: '원', normalizedValue: 180 });
  expect(items[1].unitEvidence?.level).toBe('cell');
});
it('다른 표로 단위가 새지 않고 열별 단위를 구분한다', async () => {
  const items = await x([['항목', '월(만원)', '연(원)'], ['월 소득', 427, 51240000], [], ['항목', '금액'], ['총자산', 2180]]);
  expect(items.map((c) => c.unit)).toEqual(['만 원', '원', '미확인']);
  expect(items.map((c) => c.period)).toEqual(['월간', '연간', '']);
});
it('단위가 없는 새 표 제목은 이전 표 범위를 종료한다', async () => {
  const items = await x([
    ['소득 현황표 (단위:만원)'],
    ['항목', '금액'],
    ['월 소득', 427],
    [],
    ['자산 현황표'],
    ['항목', '금액'],
    ['총자산', 2180],
  ]);
  expect(items.map((c) => c.unit)).toEqual(['만 원', '미확인']);
});
it('행과 열 헤더를 함께 사용하고 날짜 열을 금액으로 만들지 않는다', async () => {
  const items = await x([
    ['구분', '월 수입(만원)', '월 지출(만원)', '기준일'],
    ['현재', 427, 180, '2026-11-12'],
  ]);
  expect(items.map((c) => c.field)).toEqual(['income', 'fixedExpense']);
  expect(items.map((c) => c.normalizedValue)).toEqual([4270000, 1800000]);
});
it('Word 표의 헤더 단위와 월간·연간 열, 명시 단위, 날짜를 구분한다', async () => {
  const items = await d([
    ['항목', '월(만원)', '연(원)', '기준일'],
    ['월 소득', 427, 51240000, '2026/11/12'],
    ['월 지출', '180원', '2160만원', '2026-11-12'],
  ]);
  expect(items.map((c) => c.unit)).toEqual(['만 원', '원', '원', '만 원']);
  expect(items.map((c) => c.period)).toEqual(['월간', '연간', '월간', '연간']);
  expect(items.every((c) => c.originalText && c.location.includes('열'))).toBe(true);
});
it('단위 범위 수정은 명시 셀 단위와 다른 표를 보호하고 확인 상태를 해제한다', async () => {
  const items = await x([['항목', '금액'], ['월 소득', 427], ['월 지출', '180원'], [], ['항목', '금액'], ['총자산', 2180]]);
  const ids = bulkUnitIds(items, unitRangeKey(items[0]), 'B', '만 원');
  expect(ids).toEqual([items[0].id]);
  const changed = editCandidate({ ...items[0], confirmed: true }, { unit: '만 원' });
  expect(changed).toMatchObject({ confirmed: false, normalizedValue: 4270000, originalText: items[0].originalText });
});
it('전체 지출과 고정지출 소계를 합계 명칭만으로 연결하지 않는다', async () => {
  const a = (
    await x([
      ['항목', '금액(만원)'],
      ['월 지출 합계', 180],
    ])
  )[0];
  const b = (
    await d([
      ['항목', '금액(만원)'],
      ['고정지출 합계', 180],
    ])
  )[0];
  expect(assessRelationship(a, b).blocked).toBe(true);
});
it('날짜를 금액 범위로 오인하지 않지만 실제 금액 범위는 비워 둔다', () => {
  const refs = ['조건부 지원금 142만원, 반영일 2026-11-12', '조건부 지원금 100~142만원'].map((originalText, i) => ({
    source: 'DOCX' as const,
    fileName: 'synthetic.docx',
    location: `문단 ${i + 1}`,
    originalText,
  }));
  expect(extractPlanning(refs).funds.map((r) => r.amount)).toEqual(['142', '']);
});
it('병합된 금액 제목 아래 월·연 다중 헤더의 열 단위를 보존한다', async () => {
  const zip = await JSZip.loadAsync(
    await feedbackWorkbook([
      ['항목', '금액(만원)'],
      ['구분', '월', '연'],
      ['월 소득', 427, 5124],
    ]),
  );
  const path = 'xl/worksheets/sheet1.xml';
  zip.file(
    path,
    (await zip.file(path)!.async('string')).replace('</worksheet>', '<mergeCells><mergeCell ref="B1:C1"/></mergeCells></worksheet>'),
  );
  const items = extractWorkbook(await parseXlsx(await zip.generateAsync({ type: 'arraybuffer' }), 'merged.xlsx'));
  expect(items.map((c) => c.unit)).toEqual(['만 원', '만 원']);
  expect(items.map((c) => c.period)).toEqual(['월간', '연간']);
});
it('시트 메타데이터 단위와 월·연 제목은 빈 행을 사이에 둔 현금흐름 구성에도 적용된다', async () => {
  const items = await x([
    ['기준 시점: 상담 시점 · 단위: 만원'],
    [],
    ['항목', '월', '연'],
    ['월 소득', 427, 5124],
    [],
    ['미배분 잉여', 10, 120],
  ]);
  expect(items.map((c) => c.unit)).toEqual(['만 원', '만 원', '만 원', '만 원']);
  expect(items.map((c) => c.period)).toEqual(['월간', '연간', '월간', '연간']);
});
it('월세 보증금은 월 지출로 해석하지 않고 청약저축 보유액을 자산으로 보존한다', async () => {
  const items = await d([
    ['항목', '금액(만원)'],
    ['월세 보증금', 1270],
    ['청약저축', 450],
  ]);
  expect(items.map((c) => c.field)).toEqual(['housingDeposit', 'deposit']);
  expect(items.every((c) => c.period === '')).toBe(true);
});
it('미래 총자산의 명시 시점을 현재 또는 시점 불명의 자산과 구분한다', async () => {
  const zip = await JSZip.loadAsync(
    await feedbackWord([
      ['항목', '금액(만원)'],
      ['총자산', 3090],
    ]),
  );
  const path = 'word/document.xml';
  zip.file(
    path,
    (await zip.file(path)!.async('string')).replace(
      '</w:body>',
      '<w:p><w:r><w:t>1년 후 총자산은 3,500만 원입니다.</w:t></w:r></w:p></w:body>',
    ),
  );
  const items = extractWord(await parseDocx(await zip.generateAsync({ type: 'arraybuffer' }), 'future.docx'));
  expect(items.map((c) => c.period)).toEqual(['', '1년 후']);
  expect(assessRelationship(items[0], items[1]).periodConflict).toBe(true);
});
it('문장의 상대 위치를 보정해 월 소득·지출·저축·잉여금을 모두 찾는다', async () => {
  const zip = await JSZip.loadAsync(await feedbackWord([])),
    path = 'word/document.xml';
  zip.file(
    path,
    (await zip.file(path)!.async('string')).replace(
      '</w:body>',
      '<w:p><w:r><w:t>월 소득은 427만 원, 월 지출은 283만 원이며 월 저축·투자는 64만 원입니다. 따라서 월 잉여금은 80만 원입니다.</w:t></w:r></w:p></w:body>',
    ),
  );
  const items = extractWord(await parseDocx(await zip.generateAsync({ type: 'arraybuffer' }), 'cash.docx'));
  expect(items.map((c) => c.field)).toEqual(['income', 'fixedExpense', 'savings', 'surplus']);
  expect(items.map((c) => c.normalizedValue)).toEqual([4270000, 2830000, 640000, 800000]);
});
