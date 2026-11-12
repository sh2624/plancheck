import { expect, it } from 'vitest';
import { item } from './validation-fixtures';
import type { Finding } from '../src/inspection/analyze';
import { discoverCross } from '../src/validation/engine';
import { reviewQuality } from '../src/inspection/quality';
import { groupDiscoveries } from '../src/presentation/discoveries';
/** 원본과 조건을 공유하는 계산·비교 후보를 만들며 테스트 기대값은 엔진에 주입하지 않는다. */
function records() {
  const x = item('x', 'surplus', 90000, { confirmed: false });
  const d = item('d', 'surplus', 70000, {
    source: 'DOCX',
    fileName: 'test.docx',
    location: '본문 문단 1',
    confirmed: false,
    confidence: '확인 필요',
  });
  const cross: Finding = {
    id: 'cross',
    kind: 'CROSS',
    title: '두 문서 차이',
    signal: '수치 차이',
    primary: true,
    questions: [],
    result: discoverCross([x, d], [{ id: 'link', xlsxId: x.id, docxId: d.id }])[0],
  };
  const inputs = [
    item('income', 'income', 3150000, { source: 'DOCX' }),
    item('expense', 'variableExpense', 2710000, { source: 'DOCX' }),
    item('savings', 'savings', 350000, { source: 'DOCX' }),
  ];
  const calc: Finding = {
    ...cross,
    id: 'calc',
    kind: 'CALC',
    title: '재계산 차이',
    result: {
      ...cross.result,
      id: 'calc-result',
      code: 'CALC_SURPLUS',
      evidence: [d, ...inputs],
      actual: 70000,
      expected: 90000,
      difference: -20000,
      basis: '소득 - 지출 - 저축',
    },
  };
  return { x, d, cross, calc };
}
it('같은 원본 항목의 CALC·CROSS는 대표 하나이며 모든 규칙·근거·상태를 보존한다', () => {
  const { cross, calc } = records(),
    entries = reviewQuality([cross, calc]);
  const before = JSON.stringify(entries),
    groups = groupDiscoveries(entries);
  expect(groups).toHaveLength(1);
  expect(groups[0].representative.finding.id).toBe('calc');
  expect(groups[0].members.map((e) => e.finding.kind).sort()).toEqual(['CALC', 'CROSS']);
  expect(JSON.stringify(entries)).toBe(before);
});
it('동일 원본 쌍의 서로 다른 근거는 상세 구성원으로 남긴다', () => {
  const { cross } = records();
  const other = { ...cross, id: 'other', result: { ...cross.result, code: 'CROSS_OTHER_BASIS', basis: '별도 검증 근거' } };
  const groups = groupDiscoveries(reviewQuality([cross, other]));
  expect(groups).toHaveLength(1);
  expect(groups[0].members.map((e) => e.finding.result.basis)).toContain('별도 검증 근거');
});
it.each([{ fileName: 'other.docx' }, { asOf: '2030-01-01' }, { asOf: '' }, { scenario: '대안' }, { scenario: '' }, { period: '연간' }])(
  '다른 원본 또는 조건은 묶지 않는다: %j',
  (patch) => {
    const { cross } = records();
    const other = {
      ...cross,
      id: 'other',
      result: { ...cross.result, evidence: cross.result.evidence.map((c) => (c.source === 'DOCX' ? { ...c, ...patch } : c)) },
    };
    expect(groupDiscoveries(reviewQuality([cross, other]))).toHaveLength(2);
  },
);
it('계산 입력의 기준이 다르면 같은 대상·금액이어도 비교와 합치지 않는다', () => {
  const { cross, calc } = records();
  calc.result.evidence[1] = { ...calc.result.evidence[1], asOf: '2030-01-01' };
  expect(groupDiscoveries(reviewQuality([cross, calc]))).toHaveLength(2);
});
it('계산을 연결할 원본 쌍이 여럿이면 임의의 원본에 붙이지 않는다', () => {
  const { cross, calc, x, d } = records();
  const x2 = { ...x, fileName: 'other.xlsx', id: 'x2', location: '다른 시트!B7' };
  const other = { ...cross, id: 'other', result: discoverCross([x2, d], [{ id: 'other-link', xlsxId: x2.id, docxId: d.id }])[0] };
  expect(groupDiscoveries(reviewQuality([cross, other, calc]))).toHaveLength(3);
});
it('확인된 오류를 대표로 선택하되 미확인 계산을 오류로 바꾸지 않는다', () => {
  const { cross, calc } = records();
  const confirmed = { ...cross, approved: { ...cross.result, status: '오류' as const } };
  const groups = groupDiscoveries(reviewQuality([calc, confirmed]));
  expect(groups[0].representative.finding).toBe(confirmed);
  expect(groups[0].members.find((e) => e.finding.id === 'calc')!.finding.approved).toBeUndefined();
});

it('공통 원본의 반복 기재만 묶고 각 근거를 보존한다', () => {
  const { cross } = records();
  const other = {
    ...cross,
    id: 'repeat',
    result: {
      ...cross.result,
      evidence: cross.result.evidence.map((c) => (c.source === 'DOCX' ? { ...c, location: '본문 표 2', originalText: '별도 표 원문' } : c)),
    },
  };
  const groups = groupDiscoveries(reviewQuality([cross, other]));
  expect(groups).toHaveLength(1);
  expect(groups[0].members).toHaveLength(2);
  const unrelated = {
    ...other,
    id: 'unrelated',
    result: { ...other.result, evidence: other.result.evidence.map((c) => ({ ...c, location: c.location + '다른 위치' })) },
  };
  expect(groupDiscoveries(reviewQuality([cross, unrelated]))).toHaveLength(2);
});
