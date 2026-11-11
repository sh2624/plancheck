import { it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { item } from './validation-fixtures';
import { inspectDocuments } from '../src/inspection/analyze';
import { emptyPlanning } from '../src/planning/types';
import { previouslyApprovedPair, applyInlineReview } from '../src/inspection/review';
import { InlineReview } from '../src/components/InlineReview';

afterEach(cleanup);
function data(approved: boolean) {
  let state = {
    items: [
      item('x', 'loanRate', 7.5, { label: '신용대출 금리', confirmed: false }),
      item('d', 'loanRate', 6.5, { label: '신용대출 금리', source: 'DOCX', confirmed: false }),
    ],
    links: [],
    calculations: [],
  } as Parameters<typeof applyInlineReview>[0];
  const inspect = () => inspectDocuments({ ...state, planning: emptyPlanning(), references: [] })[0];
  if (approved) {
    const result = applyInlineReview(state, inspect().recommendation!, 'same');
    if (!result.ok) throw Error('승인 실패');
    state = result.state;
  }
  return { state, finding: inspect() };
}
it('자동 추천은 재사용할 승인으로 취급하지 않는다', () => {
  const { state, finding } = data(false);
  expect(previouslyApprovedPair(finding, state.items)).toBe(false);
  const ui = render(<InlineReview finding={finding} items={state.items} onApply={() => []} onComplex={() => {}} onClose={() => {}} />);
  expect((ui.getByLabelText('예, 같은 기준입니다.') as HTMLInputElement).checked).toBe(false);
});
it('현재 원본 쌍의 기존 사용자 승인만 재사용하며 다시 예를 선택할 필요가 없다', () => {
  const { state, finding } = data(true);
  expect(previouslyApprovedPair(finding, state.items)).toBe(true);
  const ui = render(<InlineReview finding={finding} items={state.items} onApply={() => []} onComplex={() => {}} onClose={() => {}} />);
  expect((ui.getByLabelText('예, 같은 기준입니다.') as HTMLInputElement).checked).toBe(true);
  expect(ui.getByText(/이미 승인했습니다/)).toBeTruthy();
});
it.each([{ number: '8', normalizedValue: 8 }, { asOf: '다른 날짜' }, { excluded: true }, { originalText: '교체된 원본 문맥' }])(
  '수정·조건 변경·제외 후 이전 승인을 재사용하지 않는다 %j',
  (patch) => {
    const { state, finding } = data(true);
    expect(
      previouslyApprovedPair(
        finding,
        state.items.map((c) => (c.id === 'x' ? { ...c, ...patch } : c)),
      ),
    ).toBe(false);
  },
);
