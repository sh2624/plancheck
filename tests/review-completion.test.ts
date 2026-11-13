import { expect, it } from 'vitest';
import { item } from './validation-fixtures';
import { inspectDocuments } from '../src/inspection/analyze';
import { emptyPlanning } from '../src/planning/types';
import { reviewCompletion } from '../src/presentation/reviewCompletion';
function finding() {
  const items = [
    item('x', 'totalAssets', 2700000, { confirmed: false, asOf: '', scenario: '', certainty: '미확인' }),
    item('d', 'totalAssets', 2600000, {
      source: 'DOCX',
      fileName: 'test.docx',
      confirmed: false,
      asOf: '',
      scenario: '',
      certainty: '미확인',
    }),
  ];
  return inspectDocuments({ items, links: [], calculations: [], references: [], planning: emptyPlanning() }).find(
    (f) => f.kind === 'CROSS',
  )!;
}
it.each(['same', 'different', 'unknown'] as const)('%s 답변의 검토 완료는 사실·승인·엔진 상태를 바꾸지 않는다', (choice) => {
  const f = { ...finding(), decision: { choice, candidateIds: ['x', 'd'], fingerprint: 'test', reviewOnly: true } },
    before = JSON.stringify(f);
  const view = reviewCompletion(f)!;
  expect(view.status).toContain('일반 검토 완료');
  expect(view.answer).toContain(choice === 'same' ? '같은 기준' : choice === 'different' ? '기준이 다릅니다' : '확인할 수 없습니다');
  expect(view.status).not.toContain('검사 통과');
  expect(view.status).not.toContain('확인된 오류');
  expect(view.next).toContain('추가 입력 없이');
  expect(JSON.stringify(f)).toBe(before);
  expect(f.result.evidence.every((c) => !c.confirmed && c.asOf === '' && c.certainty === '미확인')).toBe(true);
});
it('미답변 결과를 완료로 표시하지 않으며 기존 엔진의 승인 판정만 표시한다', () => {
  const f = finding();
  expect(reviewCompletion(f)).toBeUndefined();
  for (const status of ['오류', '검증 통과', '확인 필요'] as const) {
    const view = reviewCompletion({
      ...f,
      decision: { choice: 'same', candidateIds: [], fingerprint: '' },
      approved: { ...f.result, status },
    })!;
    expect(view.status).toContain(status === '오류' ? '확인된 오류' : status === '검증 통과' ? '검사 통과' : '오류 미확정');
  }
});
