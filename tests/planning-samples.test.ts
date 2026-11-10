import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { parseXlsx } from '../src/parsers/xlsx';
import { parseDocx } from '../src/parsers/docx';
import { extractWorkbook, extractWord } from '../src/normalization/extract';
import { workbookReferences, wordReferences, extractPlanning } from '../src/planning/extract';
import { emptyPlanning } from '../src/planning/types';
import { validatePlanning } from '../src/planning/engine';
it.skipIf(!process.env.PLANCHECK_XLSX || !process.env.PLANCHECK_DOCX)(
  '실제 문서의 조건·행동 원문을 후보로 보존하며 확인 없이 오류로 단정하지 않는다',
  async () => {
    const bytes = (p: string) => {
      const b = readFileSync(p);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    };
    const book = await parseXlsx(bytes(process.env.PLANCHECK_XLSX!), 'sample.xlsx'),
      doc = await parseDocx(bytes(process.env.PLANCHECK_DOCX!), 'sample.docx');
    const refs = [...workbookReferences(book), ...wordReferences(doc)],
      candidates = [...extractWorkbook(book), ...extractWord(doc)];
    const x = extractPlanning(refs.filter((r) => r.source === 'XLSX')),
      w = extractPlanning(refs.filter((r) => r.source === 'DOCX'));
    const state = {
      ...emptyPlanning(),
      actions: [...x.actions, ...w.actions],
      funds: [...x.funds, ...w.funds],
    };
    expect(state.actions.length).toBeGreaterThan(0);
    expect(state.funds.length).toBeGreaterThan(0);
    expect(state.actions.some((a) => a.references.some((r) => /ETF.*중단/.test(r.originalText)))).toBe(true);
    expect(state.actions.every((a) => !a.confirmed && a.references.every((r) => r.fileName && r.location && r.originalText))).toBe(true);
    expect(state.funds.every((f) => !f.confirmed && f.approval === '미확인' && f.received === '미확인' && f.destination === '미확인')).toBe(
      true,
    );
    const result = validatePlanning(candidates, state);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((r) => r.status !== '오류' && r.status !== '검증 통과')).toBe(true);
    console.log(
      JSON.stringify({
        actionCandidates: state.actions.length,
        conditionalCandidates: state.funds.length,
        unavailable: result.filter((r) => r.status === '검증 불가').length,
        review: result.filter((r) => r.status === '확인 필요').length,
      }),
    );
  },
);
