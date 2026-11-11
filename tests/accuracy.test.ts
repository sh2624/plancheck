import { it, expect, afterAll } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { accuracyFiles, accuracyCases, accuracySheet, accuracyDate, accuracyEnd, type AccuracyCase } from './accuracy-files';
import { parseXlsx } from '../src/parsers/xlsx';
import { parseDocx } from '../src/parsers/docx';
import { extractWorkbook, extractWord } from '../src/normalization/extract';
import { workbookReferences, wordReferences, extractPlanning } from '../src/planning/extract';
import { emptyPlanning, type Planning } from '../src/planning/types';
import { recommend } from '../src/recommendations/recommend';
import { applyRecommendation } from '../src/recommendations/apply';
import { inspectDocuments, type InspectionInput } from '../src/inspection/analyze';
import { validateAll } from '../src/validation/engine';
import { validatePlanning } from '../src/planning/engine';
import { applyInlineReview } from '../src/inspection/review';
import type { Result } from '../src/validation/types';

const available = !!process.env.PLANCHECK_XLSX && !!process.env.PLANCHECK_DOCX;
const measurements: Record<string, unknown>[] = [];
const codes: Record<AccuracyCase, string> = {
  CALC: 'CALC_SURPLUS',
  CROSS: 'CROSS_VALUE',
  ALLOC: 'ALLOC_CAPACITY',
  FUND: 'PLAN_CONDITIONAL',
  ACTION: 'PLAN_CONFLICT',
};
/** ZIP 바이트를 실제 파서·정규화·계획 추출·추천·검사 경로에 전달한다. */
async function load(kind: AccuracyCase, faulty: boolean, options = {}) {
  const files = await accuracyFiles(kind, faulty, options);
  const book = await parseXlsx(files.xlsx, 'evaluation.xlsx'),
    doc = await parseDocx(files.docx, 'evaluation.docx');
  const xr = workbookReferences(book),
    dr = wordReferences(doc),
    xp = extractPlanning(xr),
    dp = extractPlanning(dr);
  const input: InspectionInput = {
    items: [...extractWorkbook(book), ...extractWord(doc)],
    links: [],
    calculations: [],
    references: [...xr, ...dr],
    planning: { ...emptyPlanning(), funds: [...xp.funds, ...dp.funds], actions: [...xp.actions, ...dp.actions] },
  };
  const sheetItems = input.items.filter((c) => c.source === 'XLSX' && c.location.startsWith(accuracySheet + '!'));
  const appended = doc.blocks.findIndex((b) => b.kind === 'paragraph' && b.text === '검출 정확도 평가 부록');
  const locations = new Set(doc.blocks.slice(appended).map((b) => b.location));
  const isAppendix = (location: string) => [...locations].some((p) => location === p || location.startsWith(p + ' · '));
  const wordItems = input.items.filter((c) => c.source === 'DOCX' && isAppendix(c.location));
  const suggestions = recommend(input.items, input.links, input.planning, input.references);
  return { files, book, doc, input, sheetItems, wordItems, isAppendix, suggestions, findings: inspectDocuments(input) };
}
/** 사용자 편집을 재현한다. 빈 조건은 추측하지 않고 부록 원문에 명시된 사실만 옮긴다. */
function confirmPlanning(data: Awaited<ReturnType<typeof load>>, kind: AccuracyCase): { input: InspectionInput } {
  const { input, suggestions, isAppendix } = data;
  const rowText = (r: { references: { originalText: string; location: string }[] }) => r.references.map((p) => p.originalText).join(' ');
  const relevant = (r: { references: { location: string }[] }) => r.references.some((p) => isAppendix(p.location));
  const planning: Planning = { ...input.planning, asOf: accuracyDate };
  const ids: string[] = [];
  if (kind === 'ALLOC') {
    const allocations = suggestions
      .filter((r) => r.allocation && r.references.some((p) => isAppendix(p.location)))
      .map((r) => r.allocation!);
    expect(allocations).toHaveLength(2);
    planning.allocations = allocations.map((r) => {
      expect(rowText(r)).toContain(`${accuracyDate}~${accuracyEnd}`);
      expect(rowText(r)).toContain('현재 자산 · 확정 · 기본안');
      ids.push(r.assetId, r.goalId);
      return { ...r, start: accuracyDate, end: accuracyEnd, scenario: '기본안', funding: '현재 자산', certainty: '확정', confirmed: true };
    });
  }
  if (kind === 'FUND')
    planning.funds = input.planning.funds.map((r) => {
      if (!relevant(r)) return r;
      const text = rowText(r);
      expect(text).toContain('미승인 · 미수령');
      const amount = text.match(/지원금\s+(\d+)만 원/)![1];
      return {
        ...r,
        amount,
        unit: '만 원',
        certainty: '조건부',
        approval: '미승인',
        received: '미수령',
        destination: text.includes('현재 자산') ? '현재 자산' : '예상 시나리오',
        reflectedAt: accuracyDate,
        scenario: '기본안',
        confirmed: true,
      };
    });
  if (kind === 'ACTION')
    planning.actions = input.planning.actions.map((r) => {
      if (!relevant(r)) return r;
      expect(rowText(r)).toContain(`${accuracyDate}~${accuracyEnd}`);
      return {
        ...r,
        targetId: '평가ETF',
        amount: rowText(r).match(/월 (\d+)만 원/)![1],
        unit: '만 원',
        start: accuracyDate,
        end: accuracyEnd,
        scenario: '기본안',
        confirmed: true,
      };
    });
  return {
    input: { ...input, planning, items: input.items.map((c) => (ids.includes(c.id) ? { ...c, confirmed: true } : c)) },
  };
}
/** 자동 발견과 명시적 원문 확인 후 판정을 각각 채점하며 기존 본문의 배경 후보는 별도로 유지한다. */
async function evaluate(kind: AccuracyCase, faulty: boolean, options = {}) {
  const data = await load(kind, faulty, options),
    { input, sheetItems, wordItems, suggestions, isAppendix } = data;
  let finalInput: InspectionInput, results: Result[];
  if (kind === 'CALC') {
    const rec = suggestions.find((r) => r.calculation?.rule === 'surplus' && sheetItems.some((c) => c.id === r.calculation!.targetId));
    expect(rec).toBeTruthy();
    const state = applyRecommendation(input, rec!, true);
    finalInput = { ...input, ...state };
    results = validateAll(state.items, state.links, state.calculations);
  } else if (kind === 'CROSS') {
    const rec = suggestions.find(
      (r) => r.link && sheetItems.some((c) => c.id === r.link!.xlsxId) && wordItems.some((c) => c.id === r.link!.docxId),
    );
    expect(rec).toBeTruthy();
    if (Object.keys(options).length) {
      // 다른 조건을 같다고 덮어쓰지 않고 확인된 원문 그대로 연결한 경우의 안전성을 검사한다.
      finalInput = {
        ...input,
        items: input.items.map((c) => (rec!.candidateIds.includes(c.id) ? { ...c, confirmed: true } : c)),
        links: [{ id: 'reviewed', ...rec!.link! }],
      };
    } else {
      const out = applyInlineReview(input, rec!, 'same');
      expect(out.ok).toBe(true);
      if (!out.ok) throw Error(out.issues.join());
      finalInput = { ...input, ...out.state };
    }
    results = validateAll(finalInput.items, finalInput.links, []);
  } else {
    const confirmed = confirmPlanning(data, kind);
    finalInput = confirmed.input;
    results = validatePlanning(finalInput.items, finalInput.planning);
  }
  const relevantResult = (r: Result) =>
    r.code === codes[kind] &&
    (kind === 'CROSS'
      ? r.evidence.length === 2 &&
        r.evidence.every((c) => (c.source === 'XLSX' ? c.location.startsWith(accuracySheet + '!') : isAppendix(c.location)))
      : r.evidence.some((c) => c.location.startsWith(accuracySheet + '!') || isAppendix(c.location)) ||
        r.references?.some((p) => isAppendix(p.location)));
  const automatic = data.findings.filter((f) => relevantResult(f.result));
  const final = results.filter(relevantResult);
  expect(final).toHaveLength(1);
  expect(automatic.every((f) => !f.approved && f.result.status !== '오류' && f.result.status !== '검증 통과')).toBe(true);
  const autoDetected = automatic.some((f) => f.signal === '수치 차이' && (f.result.difference ?? 0) !== 0);
  const sourcePreserved = final.every(
    (r) =>
      (r.evidence.length > 0 || !!r.references?.length) &&
      [...r.evidence, ...(r.references ?? [])].every((p) => p.fileName && p.location && p.originalText),
  );
  expect(sourcePreserved).toBe(true);
  return { data, finalInput, automatic, final: final[0], autoDetected, sourcePreserved };
}

it.skipIf(!available).each(accuracyCases)(
  '독립 파일 복사본 %s 오류·수정·정상 결과를 구분한다',
  async (kind) => {
    const bad = await evaluate(kind, true),
      good = await evaluate(kind, false);
    expect(bad.final.status, bad.final.needs.join() + ' ' + bad.final.basis).toBe('오류');
    expect(good.final.status).toBe('검증 통과');
    expect(bad.autoDetected).toBe(['CALC', 'CROSS'].includes(kind));
    if (kind === 'CALC') expect(bad.final).toMatchObject({ actual: 70000, expected: 90000, difference: -20000 });
    if (kind === 'CROSS') expect(Math.abs(bad.final.difference!)).toBe(200000);
    if (kind === 'ALLOC') expect(bad.final).toMatchObject({ actual: 8900000, expected: 5900000, difference: 3000000 });
    if (kind === 'FUND') expect(bad.final).toMatchObject({ actual: 1320000 });
    if (kind === 'ACTION') expect(bad.final.basis).toContain('중단과 유지');
    expect(good.autoDetected).toBe(false);
    // 기존 시트 및 문단·표가 삭제되거나 재배열되지 않았는지 패키지 원문과 파싱 구조를 확인한다.
    const originalX = await JSZip.loadAsync(bad.data.files.originalXlsx),
      copiedX = await JSZip.loadAsync(bad.data.files.xlsx);
    for (const name of Object.keys(originalX.files).filter((n) => /^xl\/worksheets\/.+\.xml$/.test(n)))
      expect(await copiedX.file(name)!.async('string')).toBe(await originalX.file(name)!.async('string'));
    const originalDoc = await parseDocx(
      bad.data.files.originalDocx.buffer.slice(
        bad.data.files.originalDocx.byteOffset,
        bad.data.files.originalDocx.byteOffset + bad.data.files.originalDocx.byteLength,
      ) as ArrayBuffer,
      'evaluation.docx',
    );
    expect(bad.data.doc.blocks.slice(0, originalDoc.blocks.length)).toEqual(originalDoc.blocks);
    const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
    expect(hash(readFileSync(process.env.PLANCHECK_XLSX!))).toBe(hash(bad.data.files.originalXlsx));
    expect(hash(readFileSync(process.env.PLANCHECK_DOCX!))).toBe(hash(bad.data.files.originalDocx));
    if (process.env.PLANCHECK_ACCURACY_EXPORT) {
      mkdirSync('test-results/accuracy-fixtures', { recursive: true });
      for (const [name, run] of [
        ['error', bad],
        ['corrected', good],
      ] as const) {
        writeFileSync(`test-results/accuracy-fixtures/${kind}-${name}.xlsx`, new Uint8Array(run.data.files.xlsx));
        writeFileSync(`test-results/accuracy-fixtures/${kind}-${name}.docx`, new Uint8Array(run.data.files.docx));
      }
    }
    measurements.push({
      kind,
      expected: '오류',
      automaticSpecificDiscovery: bad.autoDetected,
      automaticStatuses: bad.automatic.map((f) => f.result.status),
      final: bad.final.status,
      actual: bad.final.actual,
      expectedValue: bad.final.expected,
      difference: bad.final.difference,
      normalFinal: good.final.status,
      normalFalsePositive: good.autoDetected,
      sourcePreserved: bad.sourcePreserved,
      failure: bad.autoDetected
        ? null
        : '필수 기간·승인·반영처·대상 연결이 자동 구조화되지 않아 구체적 오류 발견 실패. 일반 확인 후보는 성공으로 세지 않음.',
    });
  },
  30000,
);

it.skipIf(!available).each([{ otherDate: true }, { otherScenario: true }])(
  '조건이 다른 파일을 같은 사실로 확정하지 않는다 %j',
  async (options) => {
    const result = await evaluate('CROSS', true, options);
    expect(result.final.status).toBe('확인 필요');
    expect(result.final.needs.join()).toMatch(/기준일|시나리오/);
  },
  15000,
);

afterAll(() => {
  if (!available || !measurements.length) return;
  console.log('정확도 평가(독립 오류 5개): ' + JSON.stringify(measurements));
  if (process.env.PLANCHECK_ACCURACY_EXPORT) {
    mkdirSync('test-results', { recursive: true });
    writeFileSync('test-results/accuracy-evaluation.json', JSON.stringify(measurements, null, 2));
  }
});
