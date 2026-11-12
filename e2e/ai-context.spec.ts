import { test, expect } from '@playwright/test';
import { feedbackWorkbook, feedbackWord } from '../tests/feedback-fixtures';
test('Preview AI 모의 응답은 명시적 선택 후에만 호출하고 파일 교체 시 초기화한다', async ({ page }) => {
  test.skip(
    process.env.VITE_ENABLE_AI_CONTEXT !== 'true' || process.env.VERCEL_ENV !== 'preview',
    '명시적인 Preview AI 실험 빌드에서만 실행',
  );
  let calls = 0;
  await page.route('**/api/analyze-context', async (route) => {
    calls++;
    const body = route.request().postDataJSON();
    expect(body.consent).toBe(true);
    expect(JSON.stringify(body)).not.toContain('private-name');
    const source = body.sources[0];
    await route.fulfill({
      json: {
        proposals: [
          {
            kind: 'action_conflict',
            certainty: 'unknown',
            uncertainty: '동일 대상과 기간 확인 필요',
            evidence: [
              { sourceId: source.id, quote: source.text, target: '가상 ETF', number: '17', unit: '만 원', action: '중단', timing: null },
            ],
          },
        ],
        metrics: { elapsedMs: 10, estimatedUsd: 0.001 },
      },
    });
  });
  const xlsx = Buffer.from(
    await feedbackWorkbook([
      ['항목', '금액(만원)'],
      ['월 소득', 315],
    ]),
  );
  const docx = Buffer.from(await feedbackWord([['가상 ETF 월 17만 원 자동이체 중단']]));
  await page.goto('/');
  await page.getByLabel(/검토할 Excel/).setInputFiles({
    name: 'private-name.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: xlsx,
  });
  await page.getByLabel(/검토할 Word/).setInputFiles({
    name: 'private-name.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docx,
  });
  await page.getByRole('button', { name: '검사 시작', exact: true }).click();
  await page.getByText('선택형 AI 문맥 분석 · Preview 실험').click();
  const panel = page.locator('details').filter({ has: page.locator('summary', { hasText: '선택형 AI 문맥 분석' }) });
  const run = panel.getByRole('button', { name: '선택 문장 분석' });
  await expect(run).toBeDisabled();
  expect(calls).toBe(0);
  await panel.getByRole('checkbox').nth(0).check();
  await panel.getByRole('checkbox').nth(1).check();
  await run.click();
  await expect(panel).toContainText('AI 제안 · 계획 행동 관계');
  await expect(page.getByRole('region', { name: '자동 검사 결과' })).toContainText('확인된 오류 0');
  await panel.getByRole('button', { name: '상세 검토에 확인 후보 추가' }).click();
  await expect(panel).toContainText('확인 후보에 추가됨');
  await page.getByRole('button', { name: '1. 검사 시작', exact: true }).click();
  await page.getByLabel(/검토할 Word/).setInputFiles({
    name: 'replacement.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docx,
  });
  await page.getByRole('button', { name: '검사 시작', exact: true }).click();
  await page.getByText('선택형 AI 문맥 분석 · Preview 실험').click();
  await expect(panel.getByRole('button', { name: '선택 문장 분석' })).toBeDisabled();
  await expect(panel).not.toContainText('확인 후보에 추가됨');
  expect(calls).toBe(1);
});
