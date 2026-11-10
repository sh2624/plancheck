import { fireEvent, screen } from '@testing-library/react';
/** 기존 고급 기능 회귀 검사는 기본 자동 검사 화면과 분리된 진입점을 사용한다. */
export function openAdvancedResults() {
  fireEvent.click(screen.getByRole('button', { name: '2. 검사 결과' }));
  const summary = screen.getByText('고급 검사 설정·승인 결과');
  if (!summary.closest('details')?.open) fireEvent.click(summary);
}
export function openHelp() {
  const summary = screen.getByText('상세 작업 안내');
  if (!summary.closest('details')?.open) fireEvent.click(summary);
}
