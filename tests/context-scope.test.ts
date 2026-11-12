import { expect, it } from 'vitest';
import { extractWorkbook, extractWord } from '../src/normalization/extract';
import { readContext } from '../src/normalization/context';
import type { Cell, WordDocument } from '../src/parsers/types';
const cell = (address: string, value: string): Cell => ({ address, value, raw: value, type: 'inlineStr', review: false });
const row = (n: number, ...values: string[]) => values.map((v, i) => cell(`${String.fromCharCode(65 + i)}${n}`, v));
it('표 기준일·시나리오는 다른 표로 새지 않고 명시된 시트 전체 선언만 계속 상속한다', () => {
  const cells = [
    ...row(1, '기준일: 2027년 1월 2일 · 기본안'),
    ...row(2, '항목', '금액(만원)'),
    ...row(3, '총자산', '480'),
    ...row(6, '자산 현황'),
    ...row(7, '항목', '금액(만원)'),
    ...row(8, '총자산', '500'),
  ];
  const book = { fileName: 'scope.xlsx', sheets: [{ name: '표', merges: [], cells }] };
  const items = extractWorkbook(book);
  expect(items[0]).toMatchObject({ asOf: '2027-01-02', scenario: '기본안' });
  expect(items[0].contextEvidence?.[0]).toMatchObject({ scope: 'table', location: '표!A1', basis: '범위 상속' });
  expect(items[1]).toMatchObject({ asOf: '', scenario: '' });
  book.sheets[0].cells[0] = cell('A1', '시트 전체 기준일: 2027-01-02 · 기본안');
  expect(extractWorkbook(book)[1]).toMatchObject({ asOf: '2027-01-02', scenario: '기본안' });
});
it('Word 표 선언은 그 표에만 적용하고 문서 전체 선언은 다음 단계에도 보존한다', () => {
  const p = (text: string, location: string) => ({ kind: 'paragraph' as const, text, location, numbers: [] });
  const doc: WordDocument = {
    fileName: 'scope.docx',
    blocks: [
      {
        kind: 'table',
        location: '본문 표 1',
        rows: [
          [{ column: 1, span: 1, text: '표 기준일: 2027-01-02 · 기본안', paragraphs: [] }],
          [
            { column: 1, span: 1, text: '항목', paragraphs: [] },
            { column: 2, span: 1, text: '금액(만원)', paragraphs: [] },
          ],
          [
            { column: 1, span: 1, text: '총자산', paragraphs: [] },
            { column: 2, span: 1, text: '480', paragraphs: [] },
          ],
        ],
      },
      p('총자산 500만 원입니다.', '본문 문단 1'),
    ],
  };
  let items = extractWord(doc);
  expect(items[0].asOf).toBe('2027-01-02');
  expect(items[1].asOf).toBe('');
  doc.blocks.unshift(p('문서 전체 기준일: 2027-01-02 · 기본안', '본문 문단 0'));
  doc.blocks.push(p('4단계 제안', '본문 문단 2'), p('총자산 600만 원입니다.', '본문 문단 3'));
  items = extractWord(doc);
  expect(items.at(-1)).toMatchObject({ asOf: '2027-01-02', scenario: '기본안' });
});
it('잘못된 날짜·선언되지 않은 시나리오는 만들지 않고 표기만 다른 명시 날짜는 일치시킨다', () => {
  expect(readContext('기준일: 2027-02-30', '표!A1', 'table').asOf).toBe('');
  expect(readContext('기준일: 2027년 1월 2일', '표!A1', 'table')).toMatchObject({ asOf: '2027-01-02', scenario: '' });
  expect(readContext('기준일 | 2027-01-02', '표!A1,B1', 'table').asOf).toBe('2027-01-02');
});
