import { afterEach, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { ResultsView } from '../src/components/ResultsView';
import { newCalculation } from '../src/validation/types';
import { item, calculation } from './validation-fixtures';
afterEach(cleanup);
it('계산 오류를 선택해 원문과 위치를 확인하고 관련 항목으로 이동한다', () => {
  const onInspect = vi.fn();
  const items = [
    item('a', 'deposit', 40),
    item('b', 'etf', 60),
    item('t', 'totalAssets', 110),
    item('unused', 'income', 999, { confirmed: false }),
  ];
  function Harness() {
    const [specs, setSpecs] = useState([calculation('assets', 't', { parts: ['a', 'b'] })]);
    return <ResultsView items={items} links={[]} calculations={specs} onChange={setSpecs} onInspect={onInspect} />;
  }
  render(<Harness />);
  expect(screen.getByText('오류', { exact: true, selector: 'span' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /CALC_ASSETS/ }));
  const detail = screen.getByRole('region', { name: '검증 근거 상세' });
  expect(within(detail).getByText('원본 a 40')).toBeTruthy();
  expect(within(detail).getAllByText(/test.xlsx · 기준일/)).toHaveLength(3);
  fireEvent.click(within(detail).getByRole('button', { name: '관련 항목 확인·수정' }));
  expect(onInspect).toHaveBeenCalledWith(['t', 'a', 'b']);
  fireEvent.change(screen.getByLabelText('허용오차 (원)'), {
    target: { value: '10' },
  });
  expect(screen.getByText('확인 필요', { exact: true, selector: 'span' })).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByText('검증 통과', { exact: true, selector: 'span' })).toBeTruthy();
});
it('자료가 없을 때 필수 입력과 검증 불가 상태를 표시한다', () => {
  const prepare = vi.fn();
  render(
    <ResultsView
      onPrepare={prepare}
      items={[]}
      links={[]}
      calculations={[newCalculation('net', 'n')]}
      onChange={() => {}}
      onInspect={() => {}}
    />,
  );
  expect(screen.getByText('검증 불가', { exact: true, selector: 'span' })).toBeTruthy();
  expect(screen.getByText(/검사할 순자산 항목을 선택/)).toBeTruthy();
  expect(screen.getByText(/총부채: 1개 선택 필요/)).toBeTruthy();
  expect(screen.getByText('검증 준비 중', { exact: true })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '추천 검토·승인' }));
  expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ code: 'CALC_NET', status: '검증 불가' }));
});
