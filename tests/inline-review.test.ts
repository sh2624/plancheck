import { it, expect } from 'vitest';
import { item } from './validation-fixtures';
import { applyInlineReview, inlineRequirements, reviewFingerprint, removeDecisions } from '../src/inspection/review';
import type { Recommendation } from '../src/recommendations/types';
import { validateCross, discoverCross } from '../src/validation/engine';
import type { ReviewState } from '../src/recommendations/apply';
import { newCalculation } from '../src/validation/types';
const rec: Recommendation = {
  id: 'r',
  kind: 'CROSS',
  title: '금리 비교',
  candidateIds: ['x', 'd'],
  link: { xlsxId: 'x', docxId: 'd' },
  reason: '원문 관계',
  risks: [],
  missing: [],
  confidence: '원문 검토 필요',
  primary: true,
  references: [],
};
const state = () => ({
  items: [
    item('x', 'loanRate', 7.5, { label: '신용대출 금리', confirmed: false }),
    item('d', 'loanRate', 6.5, {
      label: '신용대출 금리',
      source: 'DOCX',
      confirmed: false,
    }),
  ],
  links: [],
  calculations: [],
});
it('같은 기준의 명시적 확인은 기존 연결 승인과 실제 검증 결과에 반영한다', () => {
  const input = state(),
    before = JSON.stringify(input),
    out = applyInlineReview(input, rec, 'same');
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.state.items.every((c) => c.confirmed)).toBe(true);
  expect(validateCross(out.state.items, out.state.links)[0].status).toBe('오류');
  expect(out.decision.choice).toBe('same');
  expect(JSON.stringify(input)).toBe(before);
});
it.each(['different', 'unknown'] as const)('%s 답변은 승인 연결을 해제하고 수치 차이는 보존한다', (choice) => {
  const yes = applyInlineReview(state(), rec, 'same');
  if (!yes.ok) throw Error('확인 실패');
  const out = applyInlineReview(yes.state, rec, choice);
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.state.links).toHaveLength(0);
  expect(out.decision.choice).toBe(choice);
  expect(discoverCross(out.state.items, [{ id: 'l', ...rec.link! }])[0].difference).toBe(1);
});
it('불명확한 기준일·시나리오·가정 상태를 임의로 채우거나 확정하지 않는다', () => {
  const input = state();
  input.items = input.items.map((c) => ({
    ...c,
    asOf: '',
    scenario: '',
    certainty: '가정',
  }));
  const noAnswers = applyInlineReview(input, rec, 'same');
  expect(noAnswers.ok).toBe(false);
  const pending = applyInlineReview(input, rec, 'same', {
    asOf: '2026-10-31',
    scenario: '원문 대조 시연',
  });
  if (!pending.ok) throw Error('추가 조건 확인 실패');
  expect(pending.state.items.every((c) => c.certainty === '가정')).toBe(true);
  expect(validateCross(pending.state.items, pending.state.links)[0].status).toBe('확인 필요');
  const yes = applyInlineReview(input, rec, 'same', {
    asOf: '2026-10-31',
    scenario: '원문 대조 시연',
    certaintyConfirmed: true,
  });
  if (!yes.ok) throw Error('명시적 확인 실패');
  expect(validateCross(yes.state.items, yes.state.links)[0].status).toBe('오류');
  expect(yes.state.items[0].originalText).toBe(input.items[0].originalText);
});
it('단위나 연결이 잘못된 값은 인라인 예 선택만으로 승인하지 않는다', () => {
  const input = state();
  input.items[0] = { ...input.items[0], unit: '미확인', normalizedValue: null };
  expect(inlineRequirements(input.items).units).toContain('x');
  expect(applyInlineReview(input, rec, 'same').ok).toBe(false);
  const fixed = applyInlineReview(input, rec, 'same', { units: { x: '%' } });
  expect(fixed.ok).toBe(true);
  const wrong = state();
  wrong.items[1] = { ...wrong.items[1], label: '학자금대출 금리' };
  expect(applyInlineReview(wrong, rec, 'same').ok).toBe(false);
});
it('편집은 오래된 결정과 관련 계산 범위·다른 승인 연결을 무효화한다', () => {
  const input: ReviewState = state();
  input.items[0].asOf = '';
  input.links = [{ id: 'old', xlsxId: 'x', docxId: 'other' }];
  input.calculations = [
    {
      ...newCalculation('loan', 'loan'),
      groups: { rate: ['x'] },
      scopeConfirmed: true,
    },
  ];
  const before = reviewFingerprint(input.items, rec.candidateIds),
    out = applyInlineReview(input, rec, 'same', { asOf: '2026-10-31' });
  if (!out.ok) throw Error('확인 실패');
  expect(out.changedIds).toContain('x');
  expect(out.state.links.some((l) => l.id === 'old')).toBe(false);
  expect(out.state.calculations[0].scopeConfirmed).toBe(false);
  expect(reviewFingerprint(out.state.items, rec.candidateIds)).not.toBe(before);
  const records = { r: out.decision };
  expect(removeDecisions(records, ['x'])).toEqual({});
  expect(removeDecisions(records, ['other'])).toEqual(records);
});
