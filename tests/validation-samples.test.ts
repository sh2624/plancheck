import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { parseXlsx } from '../src/parsers/xlsx';
import { parseDocx } from '../src/parsers/docx';
import { extractWorkbook, extractWord } from '../src/normalization/extract';
import type { Candidate, Field } from '../src/normalization/types';
import { validateAll, validateCross, validateCalculation } from '../src/validation/engine';
import { calculation } from './validation-fixtures';
const paths = [process.env.PLANCHECK_XLSX, process.env.PLANCHECK_DOCX];
it.skipIf(paths.some((p) => !p))('실제 샘플의 선택 확인 항목으로 교차 불일치와 계산 근거를 검증한다', async () => {
  const bytes = (p: string) => {
    const b = readFileSync(p);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const x = extractWorkbook(await parseXlsx(bytes(paths[0]!), 'sample.xlsx')),
    d = extractWord(await parseDocx(bytes(paths[1]!), 'sample.docx'));
  const choose = (items: Candidate[], field: Field, label?: RegExp, monthly = false) => {
    const c = items.find(
      (c) => c.field === field && (!label || label.test(c.label)) && (!monthly || c.period === '월간') && c.normalizedValue !== null,
    );
    expect(c, `${field} 추출`).toBeTruthy();
    return c!;
  };
  const pairs = (
    [
      ['income', undefined, true],
      ['loanRate', /신용/, false],
      ['loanBalance', /학자금/, false],
      ['totalAssets', undefined, false],
      ['netAssets', undefined, false],
      ['surplus', undefined, true],
    ] as [Field, RegExp | undefined, boolean][]
  ).map(([f, label, m]) => [choose(x, f, label, m), choose(d, f, label, m)]);
  const links = pairs.map(([a, b], i) => ({
    id: `link-${i}`,
    xlsxId: a.id,
    docxId: b.id,
  }));
  expect(validateCross([...x, ...d], links).every((r) => r.status === '검증 불가')).toBe(true);
  const confirmed = [...x, ...d].map((c) => ({
    ...c,
    confirmed: pairs.flat().some((p) => p.id === c.id),
  }));
  expect(validateCross(confirmed, links).every((r) => r.status !== '오류')).toBe(true);
  // 동일 기준·시나리오와 확정 여부를 사용자가 확인한 경우를 재현한다. 원본 숫자는 변경하지 않는다.
  const verified = [...x, ...d].map((c) => ({
    ...c,
    confirmed: true,
    certainty: '확정' as const,
    asOf: '사용자 확인 동일 기준일',
    scenario: '사용자 확인 동일안',
  }));
  const cross = validateAll(verified, links, []);
  expect(cross.map((r) => r.status)).toEqual(['검증 통과', '오류', '오류', '오류', '오류', '오류']);
  expect(cross.map((r) => r.difference)).toEqual([0, 1, -15000, -10200000, -10106000, -23980]);
  expect(cross.every((r) => r.evidence.length === 2 && r.evidence.every((c) => c.location && c.originalText))).toBe(true);
  const prefix = (c: Candidate) => (c.source === 'XLSX' ? c.location.split('!')[0] : c.location.split(' · ')[0]);
  for (const original of [x, d]) {
    const total = choose(original, 'totalAssets'),
      same = verified.filter((c) => c.source === total.source && prefix(c) === prefix(total));
    const assets = same.filter(
      (c) => ['deposit', 'etf', 'housingDeposit', 'pension'].includes(c.field) && !/[+＋]|합계|소계|참고/.test(c.label),
    );
    const assetResult = validateCalculation(verified, calculation('assets', total.id, { parts: assets.map((c) => c.id) }));
    expect(assetResult.status).toBe('검증 통과');
    const debt = choose(same, 'totalDebt'),
      net = choose(same, 'netAssets');
    expect(validateCalculation(verified, calculation('net', net.id, { assets: [total.id], debt: [debt.id] })).status).toBe('검증 통과');
  }
  const surplus = choose(x, 'surplus', undefined, true),
    cash = verified.filter((c) => c.source === 'XLSX' && prefix(c) === prefix(surplus) && c.period === '월간');
  const income = choose(cash, 'income'),
    fixed = choose(cash, 'fixedExpense', /소계/),
    variable = choose(cash, 'variableExpense', /소계/),
    savings = choose(cash, 'savings', /소계/),
    payments = cash.filter((c) => c.field === 'loanPayment');
  const cashResult = validateCalculation(
    verified,
    calculation('surplus', surplus.id, {
      income: [income.id],
      expense: [fixed.id, variable.id, ...payments.map((c) => c.id)],
      savings: [savings.id],
    }),
  );
  expect(
    cashResult.status,
    cashResult.basis + ' ' + JSON.stringify(payments.map((c) => ({ label: c.label, value: c.normalizedValue }))),
  ).toBe('검증 통과');
});
