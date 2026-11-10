import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DocumentPanel } from '../src/components/DocumentPanel';
afterEach(cleanup);
it('파일 교체 후 이전 결과와 늦은 응답을 폐기한다', async () => {
  let resolveFirst!: (s: string) => void;
  const parse = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<string>((r) => {
          resolveFirst = r;
        }),
    )
    .mockResolvedValueOnce('새 결과');
  render(
    <DocumentPanel extension="xlsx" title="Excel" parse={parse}>
      {(s) => <p>{s}</p>}
    </DocumentPanel>,
  );
  const input = screen.getByLabelText(/파일 선택/);
  const file = (name: string) =>
    Object.assign(new File(['x'], name), {
      arrayBuffer: async () => new ArrayBuffer(1),
    });
  fireEvent.change(input, { target: { files: [file('a.xlsx')] } });
  await waitFor(() => expect(parse).toHaveBeenCalledTimes(1));
  fireEvent.change(input, { target: { files: [file('b.xlsx')] } });
  await screen.findByText('새 결과');
  resolveFirst('이전 결과');
  await waitFor(() => expect(screen.queryByText('이전 결과')).toBeNull());
  fireEvent.change(input, { target: { files: [file('bad.pdf')] } });
  await screen.findByRole('alert');
  expect(screen.queryByText('새 결과')).toBeNull();
});
