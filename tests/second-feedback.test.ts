import { expect, it } from 'vitest';
import { item } from './validation-fixtures';
import { recommend } from '../src/recommendations/recommend';
import { emptyPlanning } from '../src/planning/types';
import { applyInlineReview, reviewFingerprint } from '../src/inspection/review';
import { validateCross, discoverCross } from '../src/validation/engine';
import { assessRelationship } from '../src/normalization/relationships';
import { comparisonFormat, comparisonReviewStatus } from '../src/presentation/comparison';
import { compoundDocuments } from './compound-files';
import { readableBasis } from '../src/presentation/compoundReview';
function pair(different = false) {
  const items = [
    item('x', 'totalAssets', 30900000, { unit: '만 원', number: '3090', asOf: '', scenario: '', confirmed: false }),
    item('d', 'totalAssets', 30700000, {
      source: 'DOCX',
      fileName: 'test.docx',
      unit: '만 원',
      number: '3070',
      asOf: different ? '2027-02-01' : '',
      scenario: different ? 'B안' : '',
      confirmed: false,
    }),
  ];
  if (different) {
    items[0].asOf = '2027-01-01';
    items[0].scenario = 'A안';
  }
  const rec = recommend(items, [], emptyPlanning(), []).find((r) => r.link)!;
  return { items, rec, state: { items, links: [], calculations: [] } };
}
it('기준 정보 없는 단순 비교 답변은 숫자·원문·단위·승인 상태를 바꾸지 않는다', () => {
  const { state, rec } = pair(),
    before = JSON.stringify(state);
  const out = applyInlineReview(state, rec, 'same', { recordOnly: true });
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(JSON.stringify(out.state)).toBe(before);
  expect(out.decision).toMatchObject({ choice: 'same', reviewOnly: true });
  const finding = {
    id: rec.id,
    kind: 'CROSS' as const,
    title: '비교',
    signal: '수치 차이' as const,
    primary: true,
    questions: [],
    result: discoverCross(state.items, [{ id: 'l', ...rec.link! }])[0],
  };
  expect(comparisonReviewStatus(finding)).toContain('비교 조건 미확인');
  expect(out.changedIds).toEqual([]);
  expect(reviewFingerprint([{ ...state.items[0], number: '3000' }, state.items[1]], rec.candidateIds)).not.toBe(out.decision.fingerprint);
});
it('명시적으로 다른 날짜·시나리오는 같은 기준 답변 후에도 원문 그대로이고 확정 오류가 아니다', () => {
  const { state, rec } = pair(true),
    out = applyInlineReview(state, rec, 'same', { recordOnly: true });
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.state.items).toEqual(state.items);
  const relationship = assessRelationship(state.items[0], state.items[1]);
  const result = discoverCross(state.items, [{ id: 'l', ...rec.link! }])[0];
  expect(
    comparisonReviewStatus({
      id: 'f',
      kind: 'CROSS',
      title: '비교',
      signal: '수치 차이',
      primary: true,
      questions: [],
      relationship,
      result,
    }),
  ).toContain('기준 불일치');
  expect(
    validateCross(
      state.items.map((c) => ({ ...c, confirmed: true })),
      [{ id: 'l', ...rec.link! }],
    )[0].status,
  ).toBe('확인 필요');
});
it.each(['different', 'unknown'] as const)('%s 답변은 이전 연결만 해제하고 정상이나 오류를 생성하지 않는다', (choice) => {
  const { state, rec } = pair();
  const out = applyInlineReview({ ...state, links: [{ id: 'old', ...rec.link! }] }, rec, choice, { recordOnly: true });
  expect(out.ok).toBe(true);
  if (out.ok) {
    expect(out.state.links).toEqual([]);
    expect(out.state.items).toEqual(state.items);
    expect(out.decision.reviewOnly).toBe(true);
  }
});
it('비교 표시값과 차이는 만 원으로 맞추되 소액·비영 차이·금리는 정확히 구분한다', () => {
  const { items } = pair(),
    before = JSON.stringify(items),
    f = comparisonFormat(items, '원');
  expect([f.value(30900000), f.value(30700000), f.difference(200000)]).toEqual(['3,090만 원', '3,070만 원', '20만 원']);
  expect(f.difference(20000)).toBe('2만 원');
  expect(f.difference(15000)).toBe('15,000원');
  expect(f.difference(1)).toBe('1원');
  expect(comparisonFormat([], '%').difference(1)).toBe('1.0%p');
  expect(JSON.stringify(items)).toBe(before);
});
it('ETF 빈 필드 직렬화는 읽는 문장으로 바꾸되 원본 결과와 문단은 보존한다', async () => {
  const data = await compoundDocuments(['4단계 제안', 'ETF 월 15만 원 적립 중단', '5단계 실행계획', 'ETF 월 15만 원 자동이체 유지']);
  const result = data.findings.find((f) => f.result.code === 'PLAN_CONFLICT')!.result,
    before = JSON.stringify(data);
  expect(result.basis).toContain('~');
  const text = readableBasis(result, data.planning, data.references);
  expect(text).toContain('4단계 · 제안: ETF 월 15만 원 중단');
  expect(text).toContain('5단계 · 실행');
  expect(text).toContain('적용 기간 미확인');
  expect(text).not.toContain('~');
  expect(text).not.toMatch(/,\s*,/);
  expect(JSON.stringify(data)).toBe(before);
});
