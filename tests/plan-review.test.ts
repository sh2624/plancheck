import { expect, it } from 'vitest';
import { planReviewFingerprint } from '../src/inspection/review';
import { emptyPlanning, newRecord } from '../src/planning/types';
it('같은 원본 관계의 답변은 재사용하고 관련 계획·시점·원문 변경에만 무효화한다', () => {
  const ref = { source: 'DOCX' as const, fileName: 'test.docx', location: '문단 1', originalText: '상품 적립 중단' };
  const row = { ...newRecord('action', 'a'), references: [ref] },
    state = { ...emptyPlanning(), actions: [row] };
  const key = planReviewFingerprint(state, [ref]);
  expect(planReviewFingerprint({ ...state, actions: [...state.actions, newRecord('action', 'unrelated')] }, [ref])).toBe(key);
  expect(planReviewFingerprint({ ...state, actions: [{ ...row, action: '유지' }] }, [ref])).not.toBe(key);
  expect(planReviewFingerprint(state, [{ ...ref, originalText: '상품 적립 유지' }])).not.toBe(key);
  expect(planReviewFingerprint({ ...state, asOf: '2027-01-01' }, [ref])).not.toBe(key);
});
