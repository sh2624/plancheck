import { test, expect } from '@playwright/test';
const xlsx = process.env.PLANCHECK_XLSX,
  docx = process.env.PLANCHECK_DOCX;
test('전체 기록을 유지하며 핵심 독립 발견·재무 항목 필터·부적합 관계 기록을 제공한다', async ({ page }, info) => {
  test.skip(!xlsx || !docx, '실제 로컬 문서 경로가 필요합니다.');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel(/검토할 Excel/).setInputFiles(xlsx!);
  await page.getByLabel(/검토할 Word/).setInputFiles(docx!);
  await page.getByRole('button', { name: '검사 시작', exact: true }).click();
  const panel = page.getByRole('region', { name: '자동 검사 결과' }),
    priority = page.getByRole('region', { name: '우선 검토', exact: true });
  await expect(priority.getByRole('heading', { name: /신용대출 금리.*1.0%p/ })).toBeVisible();
  await expect(priority.getByRole('heading', { name: /학자금대출 잔액.*15,000원/ })).toBeVisible();
  await expect(priority.getByRole('heading', { name: /잉여금.*23,980원/ })).toBeVisible();
  const priorityCount = await priority.locator('.finding').count(),
    total = Number((await panel.locator('.inspection-filters > span').innerText()).match(/전체 (\d+)개/)![1]);
  expect(priorityCount).toBeGreaterThan(0);
  expect(total).toBeGreaterThan(priorityCount);
  await expect(panel).toContainText('확정 오류 0');
  await expect(page.locator('.quality-extra')).not.toHaveAttribute('open', '');
  await expect(page.locator('.quality-records')).not.toHaveAttribute('open', '');
  for (const title of await priority.locator('.finding-heading').allTextContents()) expect(title).not.toMatch(/CALC_|CROSS_|ALLOC_|PLAN_/);
  await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('priority-desktop.png') });
  await page.getByLabel('재무 항목', { exact: true }).selectOption('loanRate');
  await expect(priority.locator('.finding')).toHaveCount(1);
  await expect(priority).toContainText('신용대출 금리');
  await page.getByLabel('재무 항목', { exact: true }).selectOption('deposit');
  await expect(priority.locator('.finding')).toHaveCount(0);
  await expect(priority).toContainText('정상 판정이라는 뜻은 아닙니다');
  await page.locator('.quality-records > summary').click();
  const record = page
    .getByRole('region', { name: '상세 분석 기록', exact: true })
    .locator('.finding')
    .filter({
      has: page.getByRole('button', { name: '원본 항목 확인', exact: true }),
    })
    .first();
  await expect(
    record.getByRole('heading', {
      name: '자동 연결에서 제외한 원본 기록',
      exact: true,
    }),
  ).toBeVisible();
  await expect(record.locator('.finding-comparison')).toHaveCount(0);
  await record.getByText('판단 근거 보기', { exact: true }).click();
  await expect(record).toContainText('동일 항목으로 자동 연결하지 않습니다');
  await expect(record.getByRole('button', { name: '이 항목 검토', exact: true })).toHaveCount(0);
  await page.getByLabel('재무 항목', { exact: true }).selectOption('income');
  await page.locator('.quality-filter-options > summary').click();
  await page.getByLabel('공유 원본 기록 모두 펼치기', { exact: true }).check();
  const context = page
    .getByRole('region', { name: '상세 분석 기록', exact: true })
    .locator('.finding')
    .filter({
      has: page.getByRole('heading', { name: /적용 기준이 다른 비교 기록/ }),
    })
    .first();
  await expect(context).toBeVisible();
  await expect(context.locator('.finding-comparison')).toHaveCount(0);
  await context.getByText('판단 근거 보기', { exact: true }).click();
  await expect(context).toContainText('적용 기간');
  await expect(panel).toContainText('확정 오류 0');
  await page.getByLabel('재무 항목', { exact: true }).selectOption('전체');
  await expect(panel.locator('.inspection-filters > span')).toContainText(`전체 ${total}개`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('priority-mobile.png') });
  expect(errors).toEqual([]);
});
