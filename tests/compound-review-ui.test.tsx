import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { compoundDocuments } from './compound-files';
import { compoundReview } from '../src/presentation/compoundReview';
import { InspectionResults } from '../src/components/InspectionResults';
import type { ReviewedFinding } from '../src/presentation/findingGroups';
import type { ReviewChoice } from '../src/inspection/review';
afterEach(cleanup);
const paragraphs = {
  allocation: ['검토예금 480만 원을 비상자금으로 확보합니다.', '의료비 170만 원은 검토예금에서 충당합니다.'],
  fund: ['월세 세액공제 예상액 87만 원과 계좌 정부기여금을 2년 후 자산에 포함하면 총자산은 4,900만 원입니다.'],
  action: ['4단계 제안', 'Alpha ETF 월 21만 원 적립 중단', '5단계 실행계획', 'Alpha ETF 월 21만 원 자동이체 유지'],
};
it.each(['allocation', 'fund', 'action'] as const)('%s 요약은 원본 금액·대상·단계를 사용하고 입력을 변경하지 않는다', async (kind) => {
  const data = await compoundDocuments(paragraphs[kind]);
  const finding = data.findings.find((f) => f.result.reviewHint)!;
  const before = JSON.stringify(data),
    summary = compoundReview(finding, data.planning, data.references)!;
  if (kind === 'allocation') expect(summary.values.map((v) => v.value)).toEqual(['480만 원', '650만 원']);
  if (kind === 'fund') {
    expect(summary.values.map((v) => v.value)).toEqual(['87만 원', '금액 미확인']);
    expect(summary.title).toContain('미래 자산');
  }
  if (kind === 'action') {
    expect(summary.title).toContain('Alpha ETF');
    expect(summary.values).toEqual([
      { label: '4단계 · 제안', value: '월 21만 원 · 적립 중단' },
      { label: '5단계 · 실행', value: '월 21만 원 · 자동이체 유지' },
    ]);
  }
  expect(JSON.stringify(data)).toBe(before);
  expect(compoundReview({ ...finding, approved: finding.result }, data.planning, data.references)).toBeUndefined();
});
for (const kind of ['allocation', 'fund', 'action'] as const)
  for (const choice of ['same', 'different', 'unknown'] as const) {
    it(`${kind}의 ${choice} 문구가 기존 결정 값으로 전달되고 승인·편집을 호출하지 않는다`, async () => {
      const data = await compoundDocuments(paragraphs[kind]);
      const initial = data.findings.find((f) => f.result.reviewHint)!;
      const summary = compoundReview(initial, data.planning, data.references)!;
      const onApply = vi.fn(),
        onEdit = vi.fn(),
        onPlanReview = vi.fn();
      function Harness() {
        const [finding, setFinding] = useState<ReviewedFinding>(initial);
        return (
          <InspectionResults
            {...data}
            started
            findings={[finding]}
            links={[]}
            calculations={[]}
            onApply={onApply}
            onEdit={onEdit}
            onInspect={vi.fn()}
            onPlan={vi.fn()}
            onPrepare={vi.fn()}
            onStart={vi.fn()}
            onInlineReview={() => []}
            onPlanReview={(f, answer: ReviewChoice) => {
              onPlanReview(f, answer);
              setFinding({ ...f, decision: { choice: answer, candidateIds: [], fingerprint: 'ui-test' } });
            }}
          />
        );
      }
      render(<Harness />);
      expect(screen.queryByRole('button', { name: summary.choices[choice], exact: true })).toBeNull();
      const card = screen.getByRole('heading', { name: summary.title }).closest('article')!;
      expect(card.querySelector(':scope > .finding-description')?.textContent).not.toContain(initial.result.references![0].originalText);
      fireEvent.click(within(card).getByRole('button', { name: '이 항목 검토', exact: true }));
      fireEvent.click(screen.getByLabelText(summary.choices[choice], { exact: true }));
      expect(onPlanReview).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: '답변 저장' }));
      expect(onPlanReview).toHaveBeenCalledWith(initial, choice);
      expect(screen.getByRole('status').textContent).toContain(summary.responses[choice]);
      expect(screen.getByText('확인된 오류 0')).toBeTruthy();
      expect(onApply).not.toHaveBeenCalled();
      expect(onEdit).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: '이 답변 다시 검토' }));
      expect((screen.getByLabelText(summary.choices[choice], { exact: true }) as HTMLInputElement).checked).toBe(true);
      expect(initial.approved).toBeUndefined();
    });
  }
