import { it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseXlsx } from '../src/parsers/xlsx';
import { parseDocx } from '../src/parsers/docx';
import { extractWorkbook, extractWord } from '../src/normalization/extract';
import { extractPlanning, workbookReferences, wordReferences } from '../src/planning/extract';
import { emptyPlanning } from '../src/planning/types';
import { inspectDocuments } from '../src/inspection/analyze';

it.skipIf(!process.env.PLANCHECK_AFPK_XLSX || !process.env.PLANCHECK_AFPK_DOCX)(
  'AFPK 실제 파일의 파서·정규화·검사 경로를 평가한다',
  async () => {
    const x = readFileSync(process.env.PLANCHECK_AFPK_XLSX!),
      d = readFileSync(process.env.PLANCHECK_AFPK_DOCX!);
    const buffer = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    const book = await parseXlsx(buffer(x), 'afpk.xlsx'),
      doc = await parseDocx(buffer(d), 'afpk.docx');
    const items = [...extractWorkbook(book), ...extractWord(doc)];
    const references = [...workbookReferences(book), ...wordReferences(doc)];
    const planning = { ...emptyPlanning(), ...extractPlanning(references) };
    const findings = inspectDocuments({ items, references, planning, links: [], calculations: [] });
    mkdirSync('.cache/afpk', { recursive: true });
    writeFileSync(
      `.cache/afpk/${process.env.PLANCHECK_AFPK_PHASE ?? 'after'}.json`,
      JSON.stringify({ book, doc, items, findings }, null, 2),
    );
    expect(items.find((c) => c.source === 'XLSX' && /입출금통장/.test(c.label))).toMatchObject({
      field: 'deposit',
      normalizedValue: 8000000,
    });
    expect(items.find((c) => c.source === 'XLSX' && /연금저축/.test(c.label))).toMatchObject({
      field: 'pension',
      normalizedValue: 8000000,
    });
    expect(items.find((c) => c.source === 'XLSX' && /신용카드/.test(c.label))).toMatchObject({
      field: 'loanBalance',
      normalizedValue: 2000000,
    });
    expect(
      findings.find(
        (f) =>
          f.kind === 'CALC' && f.result.evidence[0]?.source === 'DOCX' && f.result.code === 'CALC_SURPLUS' && f.result.difference !== null,
      )?.result,
    ).toMatchObject({ actual: 6000000, expected: 4800000, difference: 1200000, status: '확인 필요' });
    expect(
      findings.find(
        (f) =>
          f.kind === 'CALC' && f.result.evidence[0]?.source === 'DOCX' && f.result.code === 'CALC_ASSETS' && f.result.difference !== null,
      )?.result,
    ).toMatchObject({ actual: 230000000, expected: 200000000, difference: 30000000 });
    expect(findings.find((f) => f.kind === 'CROSS' && f.result.evidence[0]?.field === 'netAssets')?.result.difference).toBe(-30000000);
    const sheetResults = findings.filter(
      (f) => f.kind === 'CALC' && f.result.evidence[0]?.source === 'XLSX' && f.result.difference !== null,
    );
    expect(sheetResults).toHaveLength(4);
    expect(sheetResults.every((f) => f.result.difference === 0)).toBe(true);
    expect(findings.every((f) => !f.approved && f.result.status !== '오류' && f.result.status !== '검증 통과')).toBe(true);
    expect(items.every((c) => !c.confirmed)).toBe(true);
    for (const f of findings.filter((f) => f.result.difference !== null))
      expect(
        f.result.evidence.every((c) =>
          references.some(
            (ref) =>
              ref.source === c.source &&
              ref.fileName === c.fileName &&
              (c.source === 'XLSX'
                ? ref.location.split('!')[0] === c.location.split('!')[0] &&
                  ref.location.split('!')[1].split(',').includes(c.location.split('!')[1])
                : c.location.startsWith(ref.location.split(' · ')[0])),
          ),
        ),
      ).toBe(true);
    expect(readFileSync(process.env.PLANCHECK_AFPK_XLSX!).equals(x)).toBe(true);
    expect(readFileSync(process.env.PLANCHECK_AFPK_DOCX!).equals(d)).toBe(true);
  },
);
