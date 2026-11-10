import { describe, it, expect } from 'vitest';
import { item } from './validation-fixtures';
import { recommend, allocationRecommendations } from '../src/recommendations/recommend';
import { applyRecommendation } from '../src/recommendations/apply';
import { emptyPlanning, newRecord } from '../src/planning/types';
import { validateAll } from '../src/validation/engine';
const c = (...args: Parameters<typeof item>) => ({
  ...item(...args),
  confirmed: false,
});
const ref = {
  source: 'DOCX' as const,
  fileName: 'test.docx',
  location: '본문 문단 8',
  originalText: '예금 10만 원을 의료비에 배정한다.',
};
describe('계산 추천', () => {
  it('같은 시트의 구성 항목만 고르고 참고 소계·다른 출처를 합산하지 않는다', () => {
    const items = [
      c('a', 'deposit', 40),
      c('b', 'etf', 60),
      c('t', 'totalAssets', 100),
      c('sum', 'deposit', 100, { label: '참고 합계' }),
      c('other', 'deposit', 999, { location: '다른 시트!A1' }),
    ];
    const before = JSON.stringify(items);
    const r = recommend(items, [], emptyPlanning(), []).find((r) => r.calculation?.rule === 'assets')!;
    expect(r.calculation!.groups.parts).toEqual(['a', 'b']);
    expect(r.calculation!.scopeConfirmed).toBe(false);
    expect(JSON.stringify(items)).toBe(before);
    const state = { items, links: [], calculations: [] };
    const applied = applyRecommendation(state, r, false);
    expect(applied.items.every((c) => !c.confirmed)).toBe(true);
    expect(applied.calculations[0].scopeConfirmed).toBe(false);
    const approved = applyRecommendation(state, r, true);
    expect(approved.items.filter((c) => c.confirmed)).toHaveLength(3);
    expect(approved.items.find((c) => c.id === 'other')?.confirmed).toBe(false);
    expect(validateAll(approved.items, approved.links, approved.calculations)[0].status).toBe('검증 통과');
  });
  it('월간 소계·상환액을 추천하며 연간 값과 소계 구성원을 다시 합산하지 않는다', () => {
    const items = [
      c('i', 'income', 100),
      c('ia', 'income', 1200, { period: '연간' }),
      c('f', 'fixedExpense', 50, { label: '고정지출 소계' }),
      c('fl', 'fixedExpense', 20, { label: '월세' }),
      c('v', 'variableExpense', 20),
      c('p', 'loanPayment', 10),
      c('s', 'savings', 5),
      c('t', 'surplus', 15),
    ];
    const r = recommend(items, [], emptyPlanning(), []).find((r) => r.calculation?.rule === 'surplus')!;
    expect(r.calculation!.groups.income).toEqual(['i']);
    expect(r.calculation!.groups.expense).toEqual(['f', 'v', 'p']);
  });
  it('중복 총액과 빠진 대출 조건은 선택·확인을 요구한다', () => {
    const items = [
      c('a', 'totalAssets', 100),
      c('a2', 'totalAssets', 200),
      c('d', 'totalDebt', 30),
      c('n', 'netAssets', 70),
      c('pay', 'loanPayment', 10, { label: '임의A대출 상환액' }),
      c('p', 'loanBalance', 100, { label: '임의A대출 잔액' }),
      c('r', 'loanRate', 5, { label: '임의B대출 금리' }),
    ];
    const list = recommend(items, [], emptyPlanning(), []),
      net = list.find((r) => r.calculation?.rule === 'net')!,
      loan = list.find((r) => r.calculation?.rule === 'loan')!;
    expect(net.missing.join()).toContain('후보 2개');
    expect(loan.calculation!.groups.rate).toHaveLength(0);
    expect(loan.calculation!.graceMonths).toBe('');
    expect(loan.missing.join()).toContain('거치기간');
    expect(applyRecommendation({ items, links: [], calculations: [] }, net, true).items.every((c) => !c.confirmed)).toBe(true);
  });
});
describe('문서 연결 추천', () => {
  it('다른 금액도 유지하고 같은 숫자의 다른 항목이나 다른 대출은 연결하지 않는다', () => {
    const items = [
      c('x', 'income', 100),
      c('d', 'income', 120, { source: 'DOCX' }),
      c('wrong', 'totalAssets', 100, { source: 'DOCX' }),
      c('r1', 'loanRate', 5, { label: '상품A대출 금리' }),
      c('r2', 'loanRate', 5, { source: 'DOCX', label: '상품B대출 금리' }),
    ];
    const rows = recommend(items, [], emptyPlanning(), []).filter((r) => r.kind === 'CROSS');
    expect(rows).toHaveLength(1);
    expect(rows[0].link).toEqual({ xlsxId: 'x', docxId: 'd' });
    const unchanged = applyRecommendation({ items, links: [], calculations: [] }, rows[0], false);
    expect(unchanged.links).toHaveLength(0);
    expect(unchanged.items.every((c) => !c.confirmed)).toBe(true);
    const approved = applyRecommendation(unchanged, rows[0], true);
    expect(validateAll(approved.items, approved.links, [])[0].status).toBe('오류');
  });
  it('반복 후보를 유지하고 날짜·시나리오 차이는 승인 후에도 보류한다', () => {
    const items = [
      c('x', 'income', 100),
      c('d1', 'income', 120, {
        source: 'DOCX',
        asOf: '2027',
        scenario: '대체안',
      }),
      c('d2', 'income', 130, { source: 'DOCX', asOf: '2028' }),
    ];
    const rows = recommend(items, [], emptyPlanning(), []).filter((r) => r.kind === 'CROSS');
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.primary)).toHaveLength(1);
    expect(rows[0].risks.join()).toContain('다름');
    const approved = applyRecommendation({ items, links: [], calculations: [] }, rows[0], true);
    expect(validateAll(approved.items, approved.links, [])[0].status).toBe('확인 필요');
  });
  it('사용자 가정 상태를 확정으로 덮어쓰지 않으며 제외·단위 미확인 후보는 승인하지 않는다', () => {
    const items = [c('x', 'income', 100, { certainty: '가정' }), c('d', 'income', 110, { source: 'DOCX' })],
      r = recommend(items, [], emptyPlanning(), []).find((r) => r.kind === 'CROSS')!;
    const approved = applyRecommendation({ items, links: [], calculations: [] }, r, true);
    expect(approved.items[0].certainty).toBe('가정');
    expect(validateAll(approved.items, approved.links, [])[0].status).toBe('확인 필요');
    const invalid = {
      items: [{ ...items[0], unit: '미확인' as const }, items[1]],
      links: [],
      calculations: [],
    };
    expect(applyRecommendation(invalid, r, true)).toBe(invalid);
  });
});
describe('관계를 만들지 않는 계획 추천', () => {
  it('원문에 배정 관계와 유일한 이름이 있을 때만 미확인 배정 후보를 구성한다', () => {
    const items = [c('a', 'deposit', 100000, { label: '예금' }), c('g', 'goalAmount', 100000, { label: '의료비' })];
    const rows = allocationRecommendations(items, [ref]);
    expect(rows).toHaveLength(1);
    expect(rows[0].allocation?.confirmed).toBe(false);
    expect(rows[0].allocation?.start).toBe('');
    expect(rows[0].allocation?.amount).toBe('10');
    expect(allocationRecommendations(items, [{ ...ref, originalText: '예금 10만 원, 의료비 10만 원' }])).toHaveLength(0);
    expect(allocationRecommendations([...items, { ...items[0], id: 'copy' }], [ref])).toHaveLength(0);
  });
  it('조건부 후보의 승인·수령은 그대로 두고 상대 없는 계획을 만들어내지 않는다', () => {
    const fund = {
        ...newRecord('fund', 'f'),
        label: '지원금',
        references: [ref],
      },
      action = {
        ...newRecord('action', 'p'),
        targetId: '새 펀드',
        side: '제안' as const,
        references: [ref],
      };
    const state = { ...emptyPlanning(), funds: [fund], actions: [action] };
    const before = JSON.stringify(state),
      rows = recommend([], [], state, []);
    expect(rows.find((r) => r.planFocus?.id === 'f')?.missing.join()).toContain('승인');
    expect(rows.find((r) => r.planFocus?.id === 'p')?.reason).toContain('아직 특정되지');
    expect(JSON.stringify(state)).toBe(before);
    expect(rows.some((r) => r.allocation)).toBe(false);
  });
  it('수동으로 확인한 대출 설정은 같은 추천 구성을 다시 적용해도 보존한다', () => {
    const items = [
      c('t', 'loanPayment', 10, { label: '맞춤대출 상환액' }),
      c('p', 'loanBalance', 100, { label: '맞춤대출 잔액' }),
      c('r', 'loanRate', 1, { label: '맞춤대출 금리' }),
      c('n', 'loanTerm', 12, { label: '맞춤대출 잔여 기간' }),
    ];
    const r = recommend(items, [], emptyPlanning(), []).find((r) => r.calculation?.rule === 'loan')!;
    const previous = {
      ...r.calculation!,
      loanMethod: '원리금균등' as const,
      graceMonths: '0',
      loanBasis: '현재 잔액·잔여 기간' as const,
    };
    const next = applyRecommendation({ items, links: [], calculations: [previous] }, r, true);
    expect(next.calculations[0].graceMonths).toBe('0');
    expect(next.calculations[0].loanMethod).toBe('원리금균등');
  });
});

it('명의가 다른 소득과 상충하는 대출 문맥을 자동 확정하지 않는다', () => {
  const items = [
    c('x', 'income', 100, { label: '본인 월 소득' }),
    c('d', 'income', 100, { source: 'DOCX', label: '어머니 월 소득' }),
    c('p', 'loanPayment', 10, {
      label: '맞춤대출 상환액',
      originalText: '원리금균등 또는 만기일시, 거치기간 미확인',
    }),
  ];
  const rows = recommend(items, [], emptyPlanning(), []);
  expect(rows.some((r) => r.kind === 'CROSS')).toBe(false);
  expect(rows.find((r) => r.calculation?.rule === 'loan')?.calculation?.loanMethod).toBe('미확인');
});

it('동일 기간의 제안·실행 후보를 우선 안내해도 자동 승인하지 않는다', () => {
  const a = {
    ...newRecord('action', 'a'),
    targetId: '임의펀드',
    side: '제안' as const,
    action: '중단' as const,
    start: '2026-11-01',
    end: '2026-12-31',
    scenario: '기본안',
    references: [ref],
  };
  const b = { ...a, id: 'b', side: '실행' as const, action: '유지' as const };
  const state = { ...emptyPlanning(), actions: [a, b] },
    rows = recommend([], [], state, []).filter((r) => r.planFocus?.kind === 'actions');
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.primary && r.reason.includes('상대 행동'))).toBe(true);
  expect(state.actions.every((r) => !r.confirmed)).toBe(true);
});

it('참고 시나리오라도 승인 여부가 미확인이면 통과 대신 보류한다', async () => {
  const { validatePlanning } = await import('../src/planning/engine');
  const f = {
    ...newRecord('fund', 'f'),
    label: '지원금',
    amount: '20',
    unit: '만 원' as const,
    destination: '예상 시나리오' as const,
    scenario: '참고안',
    references: [ref],
    confirmed: true,
  };
  const state = { ...emptyPlanning(), funds: [f] };
  expect(
    recommend([], [], state, [])
      .find((r) => r.planFocus?.id === 'f')
      ?.missing.join(),
  ).toContain('승인');
  expect(validatePlanning([], state)[0].status).toBe('확인 필요');
});
