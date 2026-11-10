import { useState } from 'react';
import { it, expect, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { ResultsView } from '../src/components/ResultsView';
import { emptyPlanning, newRecord } from '../src/planning/types';
import { item } from './validation-fixtures';
afterEach(cleanup);
const ref = {
  source: 'DOCX' as const,
  fileName: 'test.docx',
  location: '본문 문단 3',
  originalText: '선정 전 예상 지원금을 현재 자산에 반영한 원문',
};
it('조건부 금액의 근거·승인·수령·반영처를 확인하고 수정 후 판정을 갱신한다', () => {
  function Harness() {
    const [state, setState] = useState(emptyPlanning);
    return (
      <ResultsView
        items={[]}
        links={[]}
        calculations={[]}
        onChange={() => {}}
        onInspect={() => {}}
        planning={state}
        references={[ref]}
        onPlanningChange={setState}
      />
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: /조건부 금액/ }));
  fireEvent.click(screen.getByRole('button', { name: '구조화 항목 추가' }));
  const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  change('현재 반영 검토 기준일', '2026-11-01');
  change('구조화 항목명', '주거 지원금');
  change('조건부 금액', '132');
  change('조건부 금액 단위', '만 원');
  change('금액 확정 여부', '조건부');
  change('지급·가입 승인', '미승인');
  change('실제 수령', '미수령');
  change('계획 반영일', '2026-11-01');
  change('계획 반영처', '현재 자산');
  change('금액 시나리오', '기본안');
  change('원본 문맥 연결', '0');
  expect(screen.queryByText('오류', { selector: 'span', exact: true })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByText('오류', { selector: 'span', exact: true })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /PLAN_CONDITIONAL/ }));
  const detail = screen.getByRole('region', { name: '검증 근거 상세' });
  expect(within(detail).getByText(ref.originalText)).toBeTruthy();
  change('계획 반영처', '예상 시나리오');
  expect(screen.queryByText('오류', { selector: 'span', exact: true })).toBeNull();
  expect(screen.getByText('검증 불가', { selector: 'span', exact: true })).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByText('검증 통과', { selector: 'span', exact: true })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '구조화 항목 제외' }));
  expect(screen.queryByRole('button', { name: /PLAN_CONDITIONAL/ })).toBeNull();
});
it('자산·목표 연결을 선택하고 동시에 초과 배정한 결과를 표시한다', () => {
  const items = [
    item('asset', 'deposit', 5900000, { asOf: '2026-10-31' }),
    item('g1', 'goalAmount', 5900000),
    item('g2', 'goalAmount', 3000000),
  ];
  function Harness() {
    const [state, setState] = useState(() => ({
      ...emptyPlanning(),
      allocations: [
        {
          ...newRecord('allocation', 'a'),
          label: '비상자금 배정',
          assetId: 'asset',
          goalId: 'g1',
          amount: '590',
          unit: '만 원' as const,
          scenario: '기본안',
          certainty: '확정' as const,
          funding: '현재 자산' as const,
          start: '2026-11-01',
          end: '2026-12-31',
          confirmed: true,
        },
      ],
    }));
    return (
      <ResultsView
        items={items}
        links={[]}
        calculations={[]}
        onChange={() => {}}
        onInspect={() => {}}
        planning={state}
        onPlanningChange={setState}
      />
    );
  }
  render(<Harness />);
  expect(screen.getByText('검증 통과', { selector: 'span', exact: true })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '구조화 항목 추가' }));
  for (const [label, value] of [
    ['사용할 보유 자산', 'asset'],
    ['연결할 목표액', 'g2'],
    ['배정액', '300'],
    ['배정 단위', '만 원'],
    ['배정 상태', '확정'],
    ['자금 구분', '현재 자산'],
    ['사용 시작일', '2026-11-01'],
    ['사용 종료일', '2026-12-31'],
    ['배정 시나리오', '기본안'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByText('오류', { selector: 'span', exact: true })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /ALLOC_CAPACITY/ }));
  expect(screen.getByRole('region', { name: '검증 근거 상세' }).textContent).toContain('8900000원');
});
