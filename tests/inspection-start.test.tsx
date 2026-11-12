import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../src/App';
vi.mock('../src/parsers/xlsx', () => ({
  parseXlsx: vi.fn(async () => ({ fileName: 'test.xlsx', sheets: [{ name: '표', cells: [], merges: [] }] })),
}));
vi.mock('../src/parsers/docx', () => ({ parseDocx: vi.fn(async () => ({ fileName: 'test.docx', blocks: [] })) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const upload = (source: 'Excel' | 'Word') => {
  const file = Object.assign(new File(['x'], source === 'Excel' ? 'test.xlsx' : 'test.docx'), {
    arrayBuffer: async () => new ArrayBuffer(1),
  });
  fireEvent.change(screen.getByLabelText(new RegExp(`검토할 ${source}`)), { target: { files: [file] } });
};
/** 렌더링 프레임만 제어해 임의 지연 없이 진행 표시와 취소를 검증한다. */
async function prepare() {
  render(<App />);
  expect((screen.getByRole('button', { name: '검사 시작', exact: true }) as HTMLButtonElement).disabled).toBe(true);
  upload('Excel');
  upload('Word');
  await screen.findByText('두 문서가 준비됐습니다');
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  return frames;
}
it('등록만으로 검사하지 않고 진행 문구를 그린 뒤 결과로 전환한다', async () => {
  const frames = await prepare();
  expect(screen.queryByRole('region', { name: '자동 검사 결과' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '검사 시작', exact: true }));
  expect(screen.getByRole('status').textContent).toBe('문서를 비교하고 검토할 항목을 찾고 있습니다…');
  expect((screen.getByRole('button', { name: '검사 중…', exact: true }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('region', { name: '자동 검사 결과' })).toBeNull();
  await act(async () => {
    frames.shift()!(0);
    frames.shift()!(0);
  });
  expect(screen.getByRole('region', { name: '자동 검사 결과' })).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('검사 결과');
  expect(screen.queryByText('문서를 비교하고 검토할 항목을 찾고 있습니다…')).toBeNull();
});
it('검사 대기 중 파일을 초기화하면 늦은 완료를 무시하고 재등록만으로 실행하지 않는다', async () => {
  const frames = await prepare();
  fireEvent.click(screen.getByRole('button', { name: '검사 시작', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Excel 재무표 초기화' }));
  await act(async () => {
    frames.shift()!(0);
    frames.shift()!(0);
  });
  expect(screen.queryByRole('region', { name: '자동 검사 결과' })).toBeNull();
  expect((screen.getByRole('button', { name: '검사 시작', exact: true }) as HTMLButtonElement).disabled).toBe(true);
  upload('Excel');
  await screen.findByText('두 문서가 준비됐습니다');
  expect(screen.queryByRole('region', { name: '자동 검사 결과' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '검사 시작', exact: true }));
  await act(async () => {
    frames.shift()!(0);
    frames.shift()!(0);
  });
  expect(screen.getByRole('region', { name: '자동 검사 결과' })).toBeTruthy();
});
