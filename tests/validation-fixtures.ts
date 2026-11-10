import type { Candidate } from '../src/normalization/types';
import type { Calculation } from '../src/validation/types';
import { newCalculation } from '../src/validation/types';
export function item(id: string, field: Candidate['field'], value: number, patch: Partial<Candidate> = {}): Candidate {
  const unit = field === 'loanRate' ? '%' : field === 'loanTerm' ? '개월' : '원';
  return {
    id,
    field,
    source: 'XLSX',
    fileName: 'test.xlsx',
    location: `시트!${id}`,
    label: field,
    originalText: `원본 ${id} ${value}`,
    originalNumber: String(value),
    number: String(value),
    unit,
    normalizedValue: value,
    asOf: '2026-10-31',
    scenario: '기본안',
    period: ['income', 'fixedExpense', 'variableExpense', 'savings', 'surplus', 'loanPayment'].includes(field) ? '월간' : '',
    certainty: '확정',
    confirmed: true,
    excluded: false,
    method: '행·열 문맥',
    confidence: '문맥 일치',
    note: '',
    ...patch,
  };
}
export function calculation(
  rule: Calculation['rule'],
  targetId: string,
  groups: Calculation['groups'],
  patch: Partial<Calculation> = {},
): Calculation {
  return {
    ...newCalculation(rule, rule),
    targetId,
    groups,
    scopeConfirmed: true,
    ...patch,
  };
}
