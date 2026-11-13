import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuestionReview } from '../src/components/QuestionReview';
import { InlineReview } from '../src/components/InlineReview';
import { findingType } from '../src/presentation/findingGroups';
import { inspectDocuments } from '../src/inspection/analyze';
import { emptyPlanning } from '../src/planning/types';
import { item } from './validation-fixtures';
afterEach(cleanup);
const choices = { same: '예', different: '아니요', unknown: '모름' };
it('기본 질문은 선택만으로 저장하지 않고 저장 버튼 한 번으로 기존 결정 값을 전달한다', () => {
  const onSave = vi.fn(),
    onAdvanced = vi.fn();
  render(<QuestionReview question="같은 관계인가요?" choices={choices} onSave={onSave} onAdvanced={onAdvanced} onClose={vi.fn()} />);
  expect((screen.getByRole('button', { name: '답변 저장' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('button', { name: '상세 조건 확인·수정' }).closest('details')?.hasAttribute('open')).toBe(false);
  fireEvent.click(screen.getByLabelText('아니요'));
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '답변 저장' }));
  expect(onSave).toHaveBeenCalledExactlyOnceWith('different');
  expect(onAdvanced).not.toHaveBeenCalled();
});
it('기록한 응답은 다시 열 때 선택되며 입력 상태는 원본이나 승인을 변경하지 않는다', () => {
  const onSave = vi.fn();
  render(
    <QuestionReview question="같은 관계인가요?" choices={choices} value="unknown" onSave={onSave} onAdvanced={vi.fn()} onClose={vi.fn()} />,
  );
  expect((screen.getByLabelText('모름') as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByLabelText('예'));
  expect(onSave).not.toHaveBeenCalled();
});
function finding() {
  const items = [
    item('x', 'totalAssets', 1900000, { confirmed: false }),
    item('d', 'totalAssets', 1700000, { source: 'DOCX', fileName: 'test.docx', confirmed: false }),
  ];
  return {
    items,
    finding: inspectDocuments({ items, links: [], calculations: [], references: [], planning: emptyPlanning() }).find(
      (f) => f.kind === 'CROSS',
    )!,
  };
}
it('수치 질문의 기본 저장은 최종 승인 경로 대신 기존 recordOnly를 사용한다', () => {
  const data = finding(),
    onApply = vi.fn(() => []),
    before = JSON.stringify(data);
  render(<InlineReview {...data} onApply={onApply} onComplex={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByRole('button', { name: '고급 편집·개별 승인' }).closest('details')?.hasAttribute('open')).toBe(false);
  expect(screen.getByRole('button', { name: '최종 판정 조건 입력' }).closest('details')?.hasAttribute('open')).toBe(false);
  fireEvent.click(screen.getByLabelText('예, 같은 기준입니다.'));
  fireEvent.click(screen.getByRole('button', { name: '답변 저장' }));
  expect(onApply).toHaveBeenCalledExactlyOnceWith('same', { recordOnly: true });
  expect(JSON.stringify(data)).toBe(before);
});
it('발견 유형은 차이의 존재와 원래 규칙에 따르며 정상·정보 부족을 불일치로 부르지 않는다', () => {
  const f = finding().finding;
  expect(findingType(f)).toBe('문서 간 수치 차이');
  expect(findingType({ ...f, kind: 'CALC' })).toBe('계산 결과 불일치');
  expect(findingType({ ...f, kind: 'PLAN' })).toBe('계획 확인 필요');
  expect(findingType({ ...f, kind: 'CALC', result: { ...f.result, difference: 0 } })).toBe('계산 근거 확인');
  expect(findingType({ ...f, result: { ...f.result, difference: null } })).toBe('문서 간 수치 비교');
  expect(findingType({ ...f, kind: 'CALC', approved: { ...f.result, status: '검증 통과' } })).toBe('계산 근거 확인');
  expect(findingType({ ...f, signal: '수치 일치', result: { ...f.result, difference: 1 } })).toBe('문서 간 수치 비교');
});
