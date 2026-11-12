import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { isDateTimeFormat } from '../src/parsers/numberFormat';
import { parseXlsx } from '../src/parsers/xlsx';
import { extractWorkbook } from '../src/normalization/extract';
import { workbookReferences } from '../src/planning/extract';

it.each([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58])(
  '기본 날짜·시간 서식 %i를 인식한다',
  (id) => expect(isDateTimeFormat(id)).toBe(true),
);
it.each([
  'yyyy-mm-dd',
  'm/d',
  '[$-412]yyyy"년" m"월" d"일"',
  'h:mm AM/PM',
  'mm:ss.0',
  '[h]:mm:ss',
  '[mm]',
  '[ss].00',
  '[Red][>=1]m/d;yyyy-mm-dd',
])('사용자 지정 날짜·시간 토큰 %s를 인식한다', (code) => expect(isDateTimeFormat(164, code)).toBe(true));
it.each([
  'General',
  '0',
  '#,##0',
  '0.00%',
  '0.00E+00',
  '# ?/?',
  '[Red][>=100]#,##0"원";0',
  '[$USD-409]#,##0.00',
  '0"days"',
  '0\\m',
  '0_m',
  '0*m',
])('금액·금리·일반 숫자와 리터럴 %s는 날짜로 오인하지 않는다', (code) => expect(isDateTimeFormat(164, code)).toBe(false));

/** 실제 ZIP/XML 파서와 정규화 경로를 통과하는 비식별 서식 회귀 문서를 메모리에서 만든다. */
async function formattedWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook xmlns:r="urn:rel"><sheets><sheet name="재무표" r:id="r1"/></sheets></workbook>');
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="s" Type="urn:test/styles" Target="styles.xml"/></Relationships>',
  );
  zip.file(
    'xl/styles.xml',
    '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="[$-412]yyyy/mm/dd h:mm"/><numFmt numFmtId="165" formatCode="0.00E+00"/><numFmt numFmtId="166" formatCode="0&quot;days&quot;"/></numFmts><cellXfs>' +
      [0, 14, 46, 164, 9, 165, 166].map((id) => `<xf numFmtId="${id}"/>`).join('') +
      '</cellXfs></styleSheet>',
  );
  const text = (address: string, value: string) => `<c r="${address}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const row = (index: number, label: string, style: number, value: string, formula = '') =>
    `<row>${text(`A${index}`, label)}<c r="B${index}" s="${style}">${formula ? `<f>${formula}</f>` : ''}<v>${value}</v></c></row>`;
  zip.file(
    'xl/worksheets/sheet1.xml',
    '<worksheet><sheetData><row>' +
      text('A1', '항목') +
      text('B1', '금액(만원)') +
      '</row>' +
      [
        row(2, '총자산', 1, '46338'),
        row(3, '총자산', 2, '1.5'),
        row(4, '총자산', 3, '46338.5', 'DATE(2026,11,12)+0.5'),
        row(5, '총자산', 0, '3090'),
        row(6, '신용대출 금리', 4, '0.075'),
        row(7, '총부채', 5, '400'),
        row(8, '예금', 6, '590'),
        `<row>${text('A9', '총자산')}<c r="B9" t="d"><v>2026-11-12T00:00:00Z</v></c></row>`,
      ].join('') +
      '</sheetData></worksheet>',
  );
  return parseXlsx(await zip.generateAsync({ type: 'arraybuffer' }), 'format-regression.xlsx');
}
it('날짜 일련번호는 금액이 되지 않고 실제 금액·금리·일반 숫자와 원본 날짜 문맥은 보존된다', async () => {
  const book = await formattedWorkbook(),
    candidates = extractWorkbook(book);
  expect(candidates.filter((c) => ['재무표!B2', '재무표!B3', '재무표!B4', '재무표!B9'].includes(c.location))).toHaveLength(0);
  for (const [location, value, unit] of [
    ['B5', 30900000, '만 원'],
    ['B6', 7.5, '%'],
    ['B7', 4000000, '만 원'],
    ['B8', 5900000, '만 원'],
  ] as const)
    expect(candidates.find((c) => c.location === `재무표!${location}`)).toMatchObject({ normalizedValue: value, unit });
  expect(book.sheets[0].cells.find((c) => c.address === 'B4')).toMatchObject({
    raw: '46338.5',
    value: '46338.5',
    result: '46338.5',
    formula: 'DATE(2026,11,12)+0.5',
    numberFormatId: 164,
    isDateTime: true,
  });
  expect(workbookReferences(book).find((r) => r.location.includes('B4'))?.originalText).toContain('46338.5');
});
