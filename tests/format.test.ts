import { it, expect } from 'vitest';
import { formatFinancial, formatMoney, formatRate, displayNumber } from '../src/presentation/format';
import { candidateValue } from '../src/presentation/workflow';
import { item } from './validation-fixtures';
import { validateCross } from '../src/validation/engine';
it.each([
  [4.6019981146635018, '만 원', '4.60만 원'],
  [701.5, '만 원', '701.5만 원'],
  [15000, '원', '15,000원'],
  [1, '%p', '1.0%p'],
  [7.5, '%', '7.5%'],
  [1.7000000000000002, '%', '1.7%'],
  [36, '개월', '36개월'],
  [2.5, '년', '2.5년'],
  [-15000, '원', '-15,000원'],
  [-0, '원', '0원'],
] as const)('단위별 표시 %s %s → %s', (value, unit, expected) => expect(formatFinancial(value, unit)).toBe(expected));
it('미세한 비영 차이는 작은 단위 또는 미세한 차이로 남긴다', () => {
  expect(formatMoney(0.0001, '만 원', { difference: true })).toBe('1원');
  expect(formatMoney(0.1, '원', { difference: true })).toBe('미세한 차이 (1원 미만)');
  expect(formatRate(0.001, '%p', { difference: true })).toBe('0.001%p');
  expect(formatRate(1e-12, '%p', { difference: true })).toContain('미세한 차이');
  expect(formatRate(-1e-12, '%', { difference: true })).toContain('음수');
  expect(formatFinancial(null, '원')).toBe('—');
  expect(formatFinancial(NaN, '%')).toBe('—');
  expect(formatMoney(Infinity, '원')).toBe('—');
  expect(formatRate(NaN, '%')).toBe('—');
});
it('빈 값·잘못된 쉼표는 0으로 표시하지 않는다', () => {
  for (const raw of ['', ' ', '12,34', '1x', 'Infinity']) expect(displayNumber(raw)).toBeNull();
  expect(displayNumber('1,234.5')).toBe(1234.5);
  expect(displayNumber('1e-6')).toBe(0.000001);
});
it('반올림 표시와 무관하게 원본 정규화 값으로 차이를 계산한다', () => {
  const items = [
      item('x', 'income', 46020, {
        number: '4.6019981146635018',
        unit: '만 원',
      }),
      item('d', 'income', 46000, {
        number: '4.6',
        unit: '만 원',
        source: 'DOCX',
      }),
    ],
    before = JSON.stringify(items);
  expect(candidateValue(items[0])).toBe('4.60만 원');
  expect(candidateValue(items[1])).toBe('4.6만 원');
  const result = validateCross(items, [{ id: 'l', xlsxId: 'x', docxId: 'd' }])[0];
  expect(result.difference).toBe(20);
  expect(result.status).toBe('오류');
  expect(JSON.stringify(items)).toBe(before);
});
