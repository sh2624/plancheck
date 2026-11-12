import JSZip from 'jszip';
export type FeedbackRow = (string | number)[];
const xml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
/** 팀원 원본이 없는 상태에서 헤더 단위·합계 구조만 재현한 비식별 OOXML 문서를 만든다. */
export async function feedbackFiles(options: { correct?: boolean; assets?: boolean; header?: string } = {}) {
  const rows: FeedbackRow[] = options.assets
    ? [
        ['항목', options.header ?? '금액(만원)'],
        ['예금', 590],
        ['ETF', 500],
        ['퇴직연금', 1000],
        ['보증금', 1000],
        ['총자산', options.correct ? 3090 : 3070],
      ]
    : [
        ['항목', options.header ?? '금액(만원)'],
        ['월 소득', 315],
        ['월 지출 합계', 271],
        ['월 저축·투자', 35],
        ['월 잉여금', options.correct ? 9 : 7],
      ];
  return {
    xlsx: await feedbackWorkbook(rows),
    docx: await feedbackWord([
      ['항목', '금액(만원)'],
      ['월 소득', 315],
      ['월 지출 합계', 271],
      ['월 저축·투자', 35],
      ['월 잉여금', 9],
      ['총자산', 3090],
    ]),
  };
}
/** 숫자 셀·문자열 셀과 행 사이 공백을 그대로 표현한다. */
export async function feedbackWorkbook(rows: FeedbackRow[]) {
  const zip = new JSZip();
  zip.file(
    'xl/workbook.xml',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="재무현황" sheetId="1" r:id="r1"/></sheets></workbook>',
  );
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
      .map(
        (r, i) =>
          `<row r="${i + 1}">${r
            .map((v, j) => {
              const a = String.fromCharCode(65 + j) + (i + 1);
              return typeof v === 'number' ? `<c r="${a}"><v>${v}</v></c>` : `<c r="${a}" t="inlineStr"><is><t>${xml(v)}</t></is></c>`;
            })
            .join('')}</row>`,
      )
      .join('')}</sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: 'arraybuffer' });
}
export async function feedbackWord(rows: FeedbackRow[]) {
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>${rows.map((r) => `<w:tr>${r.map((v) => `<w:tc><w:p><w:r><w:t>${xml(String(v))}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl></w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'arraybuffer' });
}
