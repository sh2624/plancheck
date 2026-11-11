import { readFileSync } from 'node:fs';
import JSZip from 'jszip';

export const accuracySheet = '검출 정확도 평가';
export type AccuracyCase = 'CALC' | 'CROSS' | 'ALLOC' | 'FUND' | 'ACTION';
export const accuracyCases: AccuracyCase[] = ['CALC', 'CROSS', 'ALLOC', 'FUND', 'ACTION'];
export const accuracyDate = '2026-10-31';
export const accuracyEnd = '2026-11-30';
const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** 원본 ZIP을 읽기 전용으로 복사하고 기존 시트·본문을 건드리지 않는 평가 부록만 추가한다. */
export async function accuracyFiles(kind: AccuracyCase, faulty: boolean, options: { otherDate?: boolean; otherScenario?: boolean } = {}) {
  const originalXlsx = readFileSync(process.env.PLANCHECK_XLSX!);
  const originalDocx = readFileSync(process.env.PLANCHECK_DOCX!);
  const x = await JSZip.loadAsync(originalXlsx),
    d = await JSZip.loadAsync(originalDocx);
  const rows: [string, number][] =
    kind === 'CALC'
      ? [
          ['월 실수령 소득', 315],
          ['월 고정지출 합계', 271],
          ['월 저축·투자 합계', 35],
          ['월 잉여금', faulty ? 7 : 9],
        ]
      : kind === 'CROSS'
        ? [['총자산', 3090]]
        : kind === 'ALLOC'
          ? [
              ['평가예금', 590],
              ['평가비상자금 목표액', 590],
              ['평가의료비 목표액', 300],
            ]
          : [];
  const textCell = (address: string, value: string) => `<c r="${address}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`;
  const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${textCell('A1', `단위: 만 원 · 기준일: ${accuracyDate} · 기본안`)}</row><row r="2">${textCell('A2', '항목')}${textCell('B2', '금액')}</row>${rows.map(([label, amount], i) => `<row r="${i + 3}">${textCell(`A${i + 3}`, label)}<c r="B${i + 3}"><v>${amount}</v></c>${textCell(`C${i + 3}`, '확정')}</row>`).join('')}</sheetData></worksheet>`;
  const wb = await x.file('xl/workbook.xml')!.async('string');
  const sheetPrefix = wb.match(/<(\w+:)?sheets[ >]/)?.[1] ?? '';
  const relationPrefix = wb.match(/xmlns:(\w+)="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships"/)?.[1] ?? 'r';
  const ids = [...wb.matchAll(/sheetId="(\d+)"/g)].map((m) => Number(m[1]));
  x.file(
    'xl/workbook.xml',
    wb.replace(
      /<\/(?:\w+:)?sheets>/,
      `<${sheetPrefix}sheet name="${accuracySheet}" sheetId="${Math.max(0, ...ids) + 1}" ${relationPrefix}:id="accuracyAppendix"/></${sheetPrefix}sheets>`,
    ),
  );
  const rels = await x.file('xl/_rels/workbook.xml.rels')!.async('string');
  x.file(
    'xl/_rels/workbook.xml.rels',
    rels.replace(
      '</Relationships>',
      '<Relationship Id="accuracyAppendix" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/accuracy.xml"/></Relationships>',
    ),
  );
  x.file('xl/worksheets/accuracy.xml', sheet);
  const ct = await x.file('[Content_Types].xml')!.async('string');
  x.file(
    '[Content_Types].xml',
    ct.replace(
      '</Types>',
      '<Override PartName="/xl/worksheets/accuracy.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ),
  );
  const paragraph = (s: string) => `<w:p><w:r><w:t xml:space="preserve">${escape(s)}</w:t></w:r></w:p>`;
  const table = (data: string[][]) =>
    `<w:tbl>${data.map((r) => `<w:tr>${r.map((v) => `<w:tc>${paragraph(v)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
  const date = options.otherDate ? '2026-11-30' : accuracyDate,
    scenario = options.otherScenario ? 'B안' : '기본안';
  const context = `기준일: ${date} · ${scenario} · 단위: 만 원`;
  const content =
    kind === 'CROSS'
      ? table([
          ['항목', '금액', '상태'],
          ['총자산', `${faulty ? 3070 : 3090}만 원`, '확정'],
        ])
      : kind === 'ALLOC'
        ? [
            `평가예금 590만 원을 평가비상자금에 배정. 현재 자산 · 확정 · 기본안 · ${accuracyDate}~${accuracyEnd}`,
            `평가예금 ${faulty ? 300 : 0}만 원을 평가의료비에 배정. 현재 자산 · 확정 · 기본안 · ${accuracyDate}~${accuracyEnd}`,
          ]
            .map(paragraph)
            .join('')
        : kind === 'FUND'
          ? paragraph(
              `평가 지원금 132만 원 · 조건부 · 미승인 · 미수령 · ${faulty ? '현재 자산' : '예상 시나리오'}에 반영 · 반영일 ${accuracyDate} · 기본안`,
            )
          : kind === 'ACTION'
            ? [
                `제안: 평가ETF 월 15만 원 적립 중단 · ${accuracyDate}~${accuracyEnd} · 기본안`,
                `실행: 평가ETF 월 15만 원 자동이체 ${faulty ? '유지' : '중단'} · ${accuracyDate}~${accuracyEnd} · 기본안`,
              ]
                .map(paragraph)
                .join('')
            : '';
  const document = await d.file('word/document.xml')!.async('string');
  const appendix = paragraph('검출 정확도 평가 부록') + paragraph(context) + content;
  // 섹션 설정은 본문의 마지막 요소로 유지한다.
  const position = document.lastIndexOf('<w:sectPr');
  d.file(
    'word/document.xml',
    position >= 0
      ? document.slice(0, position) + appendix + document.slice(position)
      : document.replace('</w:body>', appendix + '</w:body>'),
  );
  return {
    xlsx: await x.generateAsync({ type: 'arraybuffer' }),
    docx: await d.generateAsync({ type: 'arraybuffer' }),
    originalXlsx,
    originalDocx,
  };
}
