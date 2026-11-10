import { it, expect } from 'vitest';
import { item, calculation } from './validation-fixtures';
import { validateCross, validateCalculation } from '../src/validation/engine';
import { presentResult, displayValue } from '../src/presentation/results';
const links = [{ id: 'l', xlsxId: 'x', docxId: 'd' }];
it('금리와 잔액 차이를 사용자용 제목으로 설명하고 계산값을 바꾸지 않는다', () => {
  const rate = validateCross(
      [item('x', 'loanRate', 7.5, { label: '신용대출 금리' }), item('d', 'loanRate', 6.5, { source: 'DOCX', label: '신용대출 금리' })],
      links,
    )[0],
    before = JSON.stringify(rate);
  expect(presentResult(rate).headline).toBe('신용대출 금리가 1.0%p 차이 납니다.');
  expect(JSON.stringify(rate)).toBe(before);
  const balance = validateCross(
    [
      item('x', 'loanBalance', 7000000, { label: '학자금대출 잔액' }),
      item('d', 'loanBalance', 7015000, {
        source: 'DOCX',
        label: '학자금대출 잔액',
      }),
    ],
    links,
  )[0];
  expect(presentResult(balance).headline).toBe('학자금대출 잔액이 두 문서에서 다릅니다.');
  expect(presentResult(balance).description).toContain('15,000 원');
});
it('검증 불가는 준비 중이며 정상으로 표시하지 않는다', () => {
  const r = validateCalculation([], calculation('net', 'missing', { assets: [], debt: [] }));
  expect(presentResult(r).headline).toContain('검증 준비 중');
  expect(presentResult(r).nextAction).toContain('선택');
  expect(r.status).toBe('검증 불가');
});
it('다른 기준은 오류 제목으로 과장하지 않고 작은 차이는 0으로 숨기지 않는다', () => {
  const r = validateCross([item('x', 'income', 100), item('d', 'income', 200, { source: 'DOCX', asOf: '2027' })], links)[0];
  expect(presentResult(r).headline).toContain('추가 확인');
  expect(r.status).toBe('확인 필요');
  expect(displayValue(0.001, '%p')).toBe('0.001%p');
  expect(displayValue(null, '원')).toBe('—');
});
