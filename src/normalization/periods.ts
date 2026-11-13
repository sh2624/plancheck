import type { Candidate } from './types';
/** 명시적 반복 문맥의 같은 월·연 흐름만 연간 기준으로 환산한다. 일회성·불명확 기간은 제외한다. */
export function recurringConversion(a: Candidate, b: Candidate) {
  const period = (c: Candidate) =>
    ['월', '월간', '매월'].includes(c.period.trim()) ? 'month' : ['연', '연간', '매년'].includes(c.period.trim()) ? 'year' : '';
  const x = period(a),
    y = period(b);
  const eligible = (c: Candidate) =>
    ['income', 'fixedExpense', 'variableExpense', 'savings', 'surplus', 'loanPayment'].includes(c.field) &&
    ['원', '만 원', '억 원'].includes(c.unit) &&
    /매월|매년|정기적으로|정기\s*(?:소득|수입|지출|납입|적립)/.test(c.originalText) &&
    !/일회성|일시금|일회|한\s*번|특별\s*상여/.test(c.originalText);
  if (!x || !y || x === y || a.field !== b.field || !eligible(a) || !eligible(b)) return null;
  return { a: x === 'month' ? 12 : 1, b: y === 'month' ? 12 : 1 };
}
