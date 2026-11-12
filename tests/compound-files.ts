import JSZip from 'jszip';
import { parseXlsx } from '../src/parsers/xlsx';
import { parseDocx } from '../src/parsers/docx';
import { extractWorkbook, extractWord } from '../src/normalization/extract';
import { extractPlanning, workbookReferences, wordReferences } from '../src/planning/extract';
import { emptyPlanning } from '../src/planning/types';
import { inspectDocuments } from '../src/inspection/analyze';
const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
/** 임의 명칭·금액의 비식별 문서를 메모리에서 생성해 실제 파서부터 분석한다. */
export async function compoundDocuments(paragraphs: string[], asset = '검토예금', balance = 480) {
  const x = new JSZip(),
    d = new JSZip();
  const cell = (a: string, t: string) => `<c r="${a}" t="inlineStr"><is><t>${escape(t)}</t></is></c>`;
  x.file('xl/workbook.xml', '<workbook xmlns:r="urn:r"><sheets><sheet name="보유액" r:id="r1"/></sheets></workbook>');
  x.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="r1" Target="worksheets/s1.xml"/></Relationships>');
  x.file(
    'xl/worksheets/s1.xml',
    `<worksheet><sheetData><row>${cell('A1', '항목')}${cell('B1', '금액(만원)')}</row><row>${cell('A2', asset)}<c r="B2"><v>${balance}</v></c></row></sheetData></worksheet>`,
  );
  d.file(
    'word/document.xml',
    `<w:document xmlns:w="urn:w"><w:body>${paragraphs.map((t) => `<w:p><w:r><w:t>${escape(t)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`,
  );
  const book = await parseXlsx(await x.generateAsync({ type: 'arraybuffer' }), 'generated.xlsx'),
    doc = await parseDocx(await d.generateAsync({ type: 'arraybuffer' }), 'generated.docx');
  const items = [...extractWorkbook(book), ...extractWord(doc)],
    references = [...workbookReferences(book), ...wordReferences(doc)];
  const planning = { ...emptyPlanning(), ...extractPlanning(references) };
  return { items, references, planning, findings: inspectDocuments({ items, references, planning, links: [], calculations: [] }) };
}
