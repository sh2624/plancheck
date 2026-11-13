import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
test('실제 팀원 수치와 배정 관계를 날짜·시나리오 입력 없이 검토하고 파일 교체로 무효화한다', async ({ page }) => {
  const x = process.env.PLANCHECK_TEAM_XLSX,
    d = process.env.PLANCHECK_TEAM_DOCX;
  test.skip(!x || !d, '실제 팀원 파일 필요');
  await page.route('**/*', (r) => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.continue() : r.abort()));
  await page.goto('/');
  await page.getByLabel(/검토할 Excel/).setInputFiles(x!);
  await page.getByLabel(/검토할 Word/).setInputFiles(d!);
  await page.getByRole('button', { name: '검사 시작', exact: true }).click();
  const panel = page.getByRole('region', { name: '자동 검사 결과' }),
    priority = panel.locator('.quality-priority');
  await expect(priority.locator(':scope > .finding')).toHaveCount(5);
  for (const label of ['월 잉여금', '총자산']) {
    const card = priority
      .locator('.finding')
      .filter({ has: page.locator('.finding-values').filter({ hasText: label }) })
      .first();
    await card.getByRole('button', { name: '이 항목 검토', exact: true }).click();
    const detail = page.getByRole('region', { name: '선택 항목 상세 검토', exact: true });
    if (label === '총자산') {
      mkdirSync('.cache/review-completion', { recursive: true });
      await page.screenshot({ path: '.cache/review-completion/before-answer.png', fullPage: true });
    }
    await detail.getByLabel('예, 같은 기준입니다.', { exact: true }).check();
    await expect(detail.getByRole('textbox')).toHaveCount(0);
    await detail.getByRole('button', { name: '답변 저장' }).click();
    await expect(card).toContainText('일반 검토 완료 · 오류 미확정');
    await expect(card.locator(':scope > .finding-description')).toContainText('같은 기준');
    await expect(panel.getByRole('status')).toContainText('추가 입력 없이 일반 검토를 마칠 수 있습니다.');
    await expect(panel.getByRole('status')).toContainText('최종 오류로 확정한 것은 아닙니다.');
    if (label === '총자산') await page.screenshot({ path: '.cache/review-completion/after-answer.png', fullPage: true });
    await expect(panel).toContainText('확인된 오류 0');
    await card.getByRole('button', { name: '답변 수정', exact: true }).click();
    await expect(detail.getByLabel('예, 같은 기준입니다.', { exact: true })).toBeChecked();
    await expect(detail.getByRole('textbox')).toHaveCount(0);
    await detail.getByRole('button', { name: '검토 닫기' }).click();
  }
  const allocation = priority.locator('[data-review-kind="allocation"]');
  await allocation.getByRole('button', { name: '이 항목 검토', exact: true }).click();
  const detail = page.getByRole('region', { name: '선택 항목 상세 검토', exact: true });
  await expect(detail.locator('input[type=date]')).toHaveCount(0);
  await detail.getByLabel('예, 같은 예금을 동시에 사용합니다.', { exact: true }).check();
  await detail.getByRole('button', { name: '답변 저장' }).click();
  await expect(panel.locator('.compound-feedback')).toContainText('저장한 답변: 예, 같은 예금을 동시에 사용합니다.');
  await expect(panel).toContainText('확인된 오류 0');
  const action = priority.locator('[data-review-kind="action"]');
  await action.getByText('판단 근거 보기', { exact: true }).click();
  const basis = action.locator('.finding-proof > .pre');
  await expect(basis).toContainText('적용 기간 미확인');
  await expect(basis).not.toContainText('(~');
  await expect(basis).not.toContainText(', ,');
  await page.getByRole('button', { name: '1. 검사 시작', exact: true }).click();
  await page.getByLabel(/검토할 Word/).setInputFiles(d!);
  await expect(page.getByText('등록 완료 · 추출됨', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: '검사 시작', exact: true }).click();
  const asset = page
    .locator('.quality-priority .finding')
    .filter({ has: page.locator('.finding-values').filter({ hasText: '총자산' }) })
    .first();
  await asset.getByRole('button', { name: '이 항목 검토', exact: true }).click();
  await expect(page.getByLabel('예, 같은 기준입니다.', { exact: true })).not.toBeChecked();
});
