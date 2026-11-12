import { expect, it } from 'vitest';
import { compoundDocuments } from './compound-files';
import { validateActions, validateConditionalFunds, validateAllocations } from '../src/planning/engine';
import { allocationRecommendations } from '../src/recommendations/recommend';

it.each([
  ['새예금', 420, 170],
  ['여행예금', 765, 240],
] as const)('명시된 %s 배정만 연결하고 날짜 미확인을 오류로 확정하지 않는다', async (asset, balance, extra) => {
  const data = await compoundDocuments(
    [`${asset} ${balance}만 원을 비상자금으로 확보합니다.`, `의료비 ${extra}만 원은 ${asset}에서 충당합니다.`],
    asset,
    balance,
  );
  const result = data.findings.find((f) => f.kind === 'ALLOC')!.result;
  expect(result).toMatchObject({
    actual: (balance + extra) * 10000,
    expected: balance * 10000,
    difference: extra * 10000,
    status: '확인 필요',
  });
  expect(result.reviewHint).toBeDefined();
  expect(result.references).toHaveLength(2);
  expect(data.findings.every((f) => !f.approved)).toBe(true);
  const rows = allocationRecommendations(data.items, data.references).flatMap((r) => (r.allocation ? [r.allocation] : []));
  expect(validateAllocations(data.items, rows)[0].status).toBe('검증 불가');
});
it.each([
  ['예금 480만 원 보유', '비상자금 480만 원, 의료비 170만 원 필요'],
  ['검토예금 480만 원을 비상자금으로 확보합니다.', '의료비 170만 원은 새로 적립한 자금에서 충당합니다.'],
  ['검토예금 480만 원을 비상자금으로 확보 · 기본안', '검토예금 170만 원을 의료비에 배정 · 대체안'],
  [
    '검토예금 480만 원을 비상자금으로 확보 · 2027-01-01~2027-01-31 · 현재',
    '검토예금 170만 원을 의료비에 배정 · 2028-01-01~2028-01-31 · 현재',
  ],
])('독립 목표·새 적립금·대체 시나리오·다른 기간은 중복 배정으로 경고하지 않는다: %j', async (...paragraphs) => {
  const data = await compoundDocuments(paragraphs);
  expect(data.findings.filter((f) => f.kind === 'ALLOC' && f.result.reviewHint)).toHaveLength(0);
});
it.each(['평가ETF', '다른펀드', 'Alpha ETF'])('%s의 단계·행동·금액을 구분하고 원을 대상으로 만들지 않는다', async (name) => {
  const data = await compoundDocuments([
    '4단계 제안',
    `${name} 월 21만 원 적립을 중단합니다.`,
    '5단계 실행계획',
    `${name} 월 21만 원 자동이체를 유지합니다.`,
  ]);
  expect(data.planning.actions.map((a) => a.targetId)).toEqual([name, name]);
  expect(data.planning.actions.map((a) => a.amount)).toEqual(['21', '21']);
  expect(data.findings.filter((f) => f.result.reviewHint && f.result.code === 'PLAN_CONFLICT')).toHaveLength(1);
  expect(validateActions(data.items, data.planning.actions)[0].status).toBe('검증 불가');
});
it.each([
  ['제안: Alpha ETF 적립 중단', '실행: Beta ETF 자동이체 유지'],
  ['제안: 임의펀드 적립 중단', '실행: 임의펀드 자동이체 중단'],
  ['제안: 임의펀드 적립 중단 · 2027-01-01~2027-01-31', '실행: 임의펀드 자동이체 유지 · 2028-01-01~2028-01-31'],
  ['제안: 임의펀드 적립 중단 · 기본안', '실행: 임의펀드 자동이체 유지 · 대체안'],
  ['제안: 임의펀드 적립 중단하지 않습니다.', '실행: 임의펀드 자동이체 유지'],
])('정상·다른 상품·다른 기간·부정 행동에는 충돌 질문을 생성하지 않는다: %j', async (...paragraphs) => {
  const data = await compoundDocuments(paragraphs);
  expect(data.findings.filter((f) => f.result.reviewHint && f.result.code === 'PLAN_CONFLICT')).toHaveLength(0);
});
it('같은 입력의 명시된 조건을 확인한 뒤에만 기존 PLAN 엔진이 충돌을 확정한다', async () => {
  const data = await compoundDocuments([
    '제안: 임의펀드 월 23만 원 적립 중단 · 2027-01-01~2027-03-31 · 기본안',
    '실행: 임의펀드 월 23만 원 자동이체 유지 · 2027-01-01~2027-03-31 · 기본안',
  ]);
  expect(data.planning.actions.every((a) => !a.confirmed)).toBe(true);
  expect(
    validateActions(
      [],
      data.planning.actions.map((a) => ({ ...a, confirmed: true })),
    )[0].status,
  ).toBe('오류');
});
it('혜택별 금액과 미래 반영 문맥만 유지하고 총자산을 정부기여금 금액으로 쓰지 않는다', async () => {
  const data = await compoundDocuments([
    '월세 세액공제 예상액 87만 원과 계좌 정부기여금을 2년 후 자산에 포함하면 총자산은 4,900만 원입니다.',
  ]);
  expect(data.planning.funds.map((f) => f.amount)).toEqual(['87', '']);
  expect(data.planning.funds[0].relation?.timing).toBe('2년 후');
  expect(data.planning.funds.every((f) => f.approval === '미확인' && f.received === '미확인' && !f.confirmed)).toBe(true);
  expect(data.findings.filter((f) => f.result.reviewHint && f.result.code === 'PLAN_CONDITIONAL')).toHaveLength(1);
  expect(validateConditionalFunds([], data.planning).every((r) => r.status === '검증 불가')).toBe(true);
});
it.each([
  '지원금 87만 원이 예상됩니다.',
  '지원금 87만 원은 별도 참고 시나리오에만 반영합니다.',
  '예상 지원금 87만 원은 현재 자산에 포함하지 않습니다.',
])('단순 언급·별도 참고·미반영은 선반영 후보로 경고하지 않는다: %s', async (text) => {
  const data = await compoundDocuments([text]);
  expect(data.findings.filter((f) => f.result.reviewHint && f.result.code === 'PLAN_CONDITIONAL')).toHaveLength(0);
});
it('미승인·미수령·반영일이 명시된 입력도 사용자 확인 전에는 확정 오류가 아니다', async () => {
  const data = await compoundDocuments(['지원금 87만 원 · 조건부 · 미승인 · 미수령 · 현재 자산에 반영 · 반영일 2027-01-01 · 기본안']);
  const state = { ...data.planning, asOf: '2027-01-01' };
  expect(validateConditionalFunds([], state)[0].status).toBe('검증 불가');
  expect(validateConditionalFunds([], { ...state, funds: state.funds.map((f) => ({ ...f, confirmed: true })) })[0].status).toBe('오류');
});
it('확정·승인 완료·수령 완료가 명시된 정상 반영은 선반영 경고를 만들지 않는다', async () => {
  const data = await compoundDocuments(['지원금 87만 원 · 확정 · 승인 완료 · 수령 완료 · 현재 자산에 반영 · 반영일 2027-01-01 · 기본안']);
  expect(data.planning.funds[0]).toMatchObject({ certainty: '확정', approval: '승인', received: '수령', confirmed: false });
  expect(data.findings.filter((f) => f.result.reviewHint && f.result.code === 'PLAN_CONDITIONAL')).toHaveLength(0);
});
