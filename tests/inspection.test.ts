import { it, expect } from 'vitest';
import { item, calculation } from './validation-fixtures';
import { discoverCross, discoverCalculation, validateCross, validateCalculation } from '../src/validation/engine';
import { discoverPlanning, validatePlanning } from '../src/planning/engine';
import { emptyPlanning, newRecord } from '../src/planning/types';
import { inspectDocuments } from '../src/inspection/analyze';
import { extractPlanning } from '../src/planning/extract';
const link = [{ id: 'pair', xlsxId: 'x', docxId: 'd' }];
it('동일 제안에 여러 실행 근거가 있어도 결과별 고유 ID와 근거를 유지한다', () => {
  const actions = (
    [
      ['a', '제안', '중단'],
      ['b', '실행', '유지'],
      ['c', '실행', '시작'],
    ] as const
  ).map(([id, side, action]) => ({
    ...newRecord('action', id),
    label: `계획 ${id}`,
    targetId: '펀드 적립',
    side,
    action,
    start: '2026-11-01',
    end: '2026-12-01',
    scenario: '기본안',
    references: [
      {
        source: 'DOCX' as const,
        fileName: 'plan.docx',
        location: `문단 ${id}`,
        originalText: `원본 계획 ${id}`,
      },
    ],
  }));
  const findings = inspectDocuments({
    items: [],
    links: [],
    calculations: [],
    planning: { ...emptyPlanning(), actions },
    references: [],
  });
  expect(findings).toHaveLength(2);
  expect(new Set(findings.map((f) => f.id)).size).toBe(2);
  expect(findings.every((f) => f.result.references?.length === 2)).toBe(true);
});
it('단순 지원금 예시가 잘못 추천돼도 선반영 오류로 단정하지 않고 제외할 수 있다', () => {
  const ref = {
    source: 'DOCX' as const,
    fileName: 'example.docx',
    location: '문단 2',
    originalText: '지원금 73만 원은 설명용 예시이며 가입하지 않았습니다.',
  };
  const p = extractPlanning([ref]);
  expect(p.funds.length).toBe(1);
  const input = {
    items: [],
    links: [],
    calculations: [],
    planning: { ...emptyPlanning(), ...p },
    references: [ref],
  };
  const findings = inspectDocuments(input);
  expect(findings[0].result.status).toBe('확인 필요');
  expect(findings[0].approved).toBeUndefined();
  expect(findings[0].primary).toBe(false);
  expect(
    inspectDocuments({
      ...input,
      planning: {
        ...input.planning,
        funds: p.funds.map((f) => ({ ...f, excluded: true })),
      },
    }),
  ).toHaveLength(0);
});
it('미확인 금리 차이를 발견해도 승인 상태와 기존 확정 판정을 변경하지 않는다', () => {
  const items = [
    item('x', 'loanRate', 4.2, { label: '신용대출 금리', confirmed: false }),
    item('d', 'loanRate', 5.1, {
      source: 'DOCX',
      label: '신용대출 금리',
      confirmed: false,
      asOf: '2027-01-01',
      scenario: '대안',
    }),
  ];
  const before = JSON.stringify(items),
    r = discoverCross(items, link)[0];
  expect(r.difference).toBeCloseTo(-0.9);
  expect(r.status).toBe('확인 필요');
  expect(r.needs).toContain('기준일 불일치');
  expect(validateCross(items, link)[0].status).toBe('검증 불가');
  expect(JSON.stringify(items)).toBe(before);
});
it('단위 환산·수치 일치도 참고 후보이며 누락 값은 0이나 정상으로 바꾸지 않는다', () => {
  const items = [
    item('x', 'income', 1000000, { confirmed: false }),
    item('d', 'income', 1000000, {
      source: 'DOCX',
      number: '100',
      unit: '만 원',
      confirmed: false,
    }),
  ];
  expect(discoverCross(items, link)[0]).toMatchObject({
    difference: 0,
    status: '확인 필요',
  });
  items[1] = { ...items[1], number: '', normalizedValue: null };
  expect(discoverCross(items, link)[0]).toMatchObject({
    difference: null,
    status: '검증 불가',
  });
});
it('계산 후보를 자동 분석하지만 구성 범위 승인과 사용자 확인은 요구한다', () => {
  const items = [item('a', 'deposit', 300, { confirmed: false }), item('t', 'totalAssets', 350, { confirmed: false })];
  const spec = calculation('assets', 't', { parts: ['a'] }, { scopeConfirmed: false });
  expect(discoverCalculation(items, spec)).toMatchObject({
    expected: 300,
    difference: 50,
    status: '확인 필요',
  });
  expect(validateCalculation(items, spec).status).toBe('검증 불가');
  expect(spec.scopeConfirmed).toBe(false);
});
it('동일한 이름·금액이어도 다른 대출의 관계를 생성하지 않는다', () => {
  const items = [
    item('x', 'loanRate', 4, { label: '신용대출 금리', confirmed: false }),
    item('d', 'loanRate', 4, {
      label: '학자금대출 금리',
      source: 'DOCX',
      confirmed: false,
    }),
  ];
  expect(
    inspectDocuments({
      items,
      links: [],
      calculations: [],
      planning: emptyPlanning(),
      references: [],
    }).filter((f) => f.kind === 'CROSS'),
  ).toEqual([]);
});
it('불명확한 대출 약정으로 자동 상환 계산값을 확정하지 않는다', () => {
  const items = [
    item('p', 'loanPrincipal', 1000000, { confirmed: false }),
    item('r', 'loanRate', 7, { confirmed: false }),
    item('n', 'loanTerm', 12, { confirmed: false }),
    item('t', 'loanPayment', 100000, { confirmed: false }),
  ];
  const spec = calculation('loan', 't', { principal: ['p'], rate: ['r'], term: ['n'] }, { scopeConfirmed: false });
  expect(discoverCalculation(items, spec)).toMatchObject({
    expected: null,
    difference: null,
    status: '확인 필요',
  });
});
it('배정·조건부 금액·행동 충돌도 미확인 상태 그대로 참고 분석한다', () => {
  const items = [item('a', 'deposit', 800, { confirmed: false }), item('g', 'goalAmount', 1200, { confirmed: false })];
  const ref = {
    source: 'DOCX' as const,
    fileName: '문서.docx',
    location: '본문 표 2',
    originalText: '원문에 명시된 관계',
  };
  const state = {
    ...emptyPlanning(),
    asOf: '2026-11-01',
    allocations: [
      {
        ...newRecord('allocation', 'a'),
        label: '운영자금 배정',
        assetId: 'a',
        goalId: 'g',
        amount: '1000',
        unit: '원' as const,
        certainty: '확정' as const,
        scenario: '기본안',
        funding: '현재 자산' as const,
        start: '2026-11-01',
        end: '2026-12-01',
      },
    ],
    funds: [
      {
        ...newRecord('fund', 'f'),
        label: '지원금',
        amount: '73',
        unit: '원' as const,
        certainty: '조건부' as const,
        approval: '미승인' as const,
        received: '미수령' as const,
        destination: '현재 자산' as const,
        scenario: '기본안',
        reflectedAt: '2026-11-01',
        references: [ref],
      },
    ],
    actions: (
      [
        ['x', '제안', '중단'],
        ['y', '실행', '유지'],
      ] as const
    ).map(([id, side, action]) => ({
      ...newRecord('action', id),
      label: '펀드 적립',
      targetId: '펀드 적립',
      side,
      action,
      start: '2026-11-01',
      end: '2026-12-01',
      scenario: '기본안',
      references: [ref],
    })),
  };
  const before = JSON.stringify({ items, state }),
    results = discoverPlanning(items, state);
  expect(results.map((r) => r.code)).toEqual(['ALLOC_CAPACITY', 'PLAN_CONDITIONAL', 'PLAN_CONFLICT']);
  expect(results.every((r) => r.status === '확인 필요')).toBe(true);
  expect(results[0].difference).toBe(200);
  expect(validatePlanning(items, state).every((r) => r.status === '검증 불가')).toBe(true);
  expect(JSON.stringify({ items, state })).toBe(before);
});
