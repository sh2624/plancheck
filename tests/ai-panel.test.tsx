import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AiContextPanel } from '../src/components/AiContextPanel';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('선택과 동의 전에는 전송하지 않고 실패해도 기본 검사 상태를 수정하지 않는다', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: false });
  vi.stubGlobal('fetch', fetcher);
  const onImport = vi.fn();
  const user = userEvent.setup();
  render(
    <AiContextPanel
      references={[{ source: 'DOCX', fileName: 'private.docx', location: '문단 1', originalText: '가상 ETF 자동이체 중단' }]}
      onImport={onImport}
    />,
  );
  await user.click(screen.getByText('선택형 AI 문맥 분석 · Preview 실험'));
  const button = screen.getByRole('button', { name: '선택 문장 분석' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getAllByRole('checkbox')[0]);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getAllByRole('checkbox')[1]);
  await user.click(button);
  expect(await screen.findByText(/AI 분석을 완료하지 못했습니다/)).toBeTruthy();
  expect(fetcher).toHaveBeenCalledOnce();
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body).toEqual({ consent: true, sources: [{ id: 's0', text: '가상 ETF 자동이체 중단' }] });
  expect(onImport).not.toHaveBeenCalled();
});
