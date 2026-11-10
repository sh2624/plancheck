import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseXlsx } from '../src/parsers/xlsx';
import { parseDocx } from '../src/parsers/docx';
import { validateFile } from '../src/parsers/package';
async function pack(files: Record<string, string>) {
  const zip = new JSZip();
  for (const [path, xml] of Object.entries(files)) zip.file(path, xml);
  return zip.generateAsync({ type: 'arraybuffer' });
}
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
async function workbook(cells: string) {
  return pack({
    'xl/workbook.xml': `<workbook xmlns="${ns}" xmlns:r="urn:rel"><sheets><sheet name="재무표" r:id="r1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${ns}"><sheetData><row>${cells}</row></sheetData><mergeCells><mergeCell ref="A3:B3"/></mergeCells></worksheet>`,
  });
}
describe('XLSX 원본 추출', () => {
  it('누락되거나 잘못된 공유 문자열 참조를 0번 문자열로 대체하지 않는다', async () => {
    const zip = await JSZip.loadAsync(await workbook('<c r="A1" t="s"/><c r="B1" t="s"><v>0</v></c><c r="C1" t="s"><v>99</v></c>'));
    zip.file(
      'xl/_rels/workbook.xml.rels',
      '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="s1" Type="urn:test/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
    );
    zip.file('xl/sharedStrings.xml', `<sst xmlns="${ns}"><si><t>실제 문자열</t></si></sst>`);
    const result = await parseXlsx(await zip.generateAsync({ type: 'arraybuffer' }), 'test.xlsx');
    expect(result.sheets[0].cells[0]).toMatchObject({ value: '', raw: '', review: true });
    expect(result.sheets[0].cells[1]).toMatchObject({ value: '실제 문자열', review: false });
    expect(result.sheets[0].cells[2]).toMatchObject({ raw: '99', review: true });
  });
  it('0 캐시와 누락 캐시, 오류, 텍스트 및 위치를 구분한다', async () => {
    const result = await parseXlsx(
      await workbook(
        '<c r="A1"><f>1-1</f><v>0</v></c><c r="B1"><f>SUM(A1)</f></c><c r="C1" t="inlineStr"><is><t>자산</t></is></c><c r="D1" t="e"><f>1/0</f><v>#DIV/0!</v></c>',
      ),
      'test.xlsx',
    );
    expect(result.sheets[0].name).toBe('재무표');
    expect(result.sheets[0].merges).toEqual(['A3:B3']);
    expect(result.sheets[0].cells[0]).toMatchObject({
      address: 'A1',
      result: '0',
      review: false,
      formula: '1-1',
    });
    expect(result.sheets[0].cells[1]).toMatchObject({
      review: true,
      result: undefined,
    });
    expect(result.sheets[0].cells[2].value).toBe('자산');
    expect(result.sheets[0].cells[3].review).toBe(true);
  });
  it('손상된 파일은 실패한다', async () => {
    await expect(parseXlsx(new ArrayBuffer(3), 'bad.xlsx')).rejects.toThrow();
  });
});
describe('DOCX 원본 추출', () => {
  it('분리된 런과 숫자 문맥, 행열 병합, 빈 문단을 보존한다', async () => {
    const data = await pack({
      'word/document.xml':
        '<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>월 소득 </w:t></w:r><w:r><w:t>150만원</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>50</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr></w:tbl><w:p/></w:body></w:document>',
    });
    const result = await parseDocx(data, 'test.docx');
    expect(result.blocks[0]).toMatchObject({
      text: '월 소득 150만원',
      numbers: ['150만원'],
      location: '본문 문단 1',
    });
    const table = result.blocks[1];
    if (table.kind !== 'table') throw Error('표 누락');
    expect(table.rows[0][0]).toMatchObject({
      column: 1,
      span: 2,
      merge: 'restart',
      text: '50',
    });
    expect(table.rows[0][1].column).toBe(3);
    expect(table.rows[1][0].merge).toBe('continue');
    expect(result.blocks[2]).toMatchObject({ text: '' });
  });
  it('본문 없는 문서는 실패한다', async () => {
    await expect(parseDocx(await pack({ 'word/document.xml': '<document/>' }), 'test.docx')).rejects.toThrow('본문');
  });
});
it('형식, 빈 파일, 크기 제한을 검사한다', () => {
  expect(() => validateFile({ name: 'x.pdf', size: 1 }, 'xlsx')).toThrow();
  expect(() => validateFile({ name: 'x.xlsx', size: 0 }, 'xlsx')).toThrow();
  expect(() => validateFile({ name: 'x.XLSX', size: 30 * 1024 * 1024 }, 'xlsx')).not.toThrow();
  expect(() => validateFile({ name: 'x.xlsx', size: 30 * 1024 * 1024 + 1 }, 'xlsx')).toThrow();
});
