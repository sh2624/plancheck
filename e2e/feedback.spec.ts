import { test, expect } from '@playwright/test';
import { feedbackFiles, feedbackWorkbook } from '../tests/feedback-fixtures';

for (const assets of [false, true])
  test(`헤더 단위만 있는 재현 파일의 ${assets ? '총자산' : '월 잉여금'} 차이를 확인 없이 발견한다`, async ({ page }) => {
    const files = await feedbackFiles({ assets });
    await page.goto('/');
    await page.getByLabel(/검토할 Excel/).setInputFiles({
      name: 'feedback.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(files.xlsx),
    });
    await page.getByLabel(/검토할 Word/).setInputFiles({
      name: 'feedback.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from(files.docx),
    });
    await page.getByRole('button', { name: '검사 시작', exact: true }).click();
    const panel = page.getByRole('region', { name: '자동 검사 결과' });
    await expect(panel).toContainText('확인된 오류 0');
    await expect(panel.locator('.quality-priority')).toContainText(assets ? '200,000원' : '20,000원');
    await expect(panel.locator('.quality-priority')).toContainText('확인 필요');
  });
test('불명확한 표 단위는 사용자가 범위를 지정하면 다시 계산하며 자동 승인하지 않는다', async ({ page }) => {
  const files = await feedbackFiles();
  const xlsx = await feedbackWorkbook([
    ['항목', '금액'],
    ['월 소득', 315],
    ['월 지출 합계', 271],
    ['월 저축·투자', 35],
    ['월 잉여금', 7],
  ]);
  await page.goto('/');
  await page.getByLabel(/검토할 Excel/).setInputFiles({
    name: 'unknown.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(xlsx),
  });
  await page.getByLabel(/검토할 Word/).setInputFiles({
    name: 'feedback.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(files.docx),
  });
  await page.getByRole('button', { name: '검사 시작', exact: true }).click();
  const panel = page.getByRole('region', { name: '자동 검사 결과' });
  await expect(panel.locator('.quality-priority .finding').filter({ hasText: '20,000원' })).toHaveCount(0);
  await page.getByRole('button', { name: '3. 상세 검토', exact: true }).click();
  await page.getByText('표·열 단위 일괄 지정', { exact: true }).click();
  const bulk = page.locator('.bulk-units');
  const xRange = bulk.getByLabel('단위를 지정할 표').getByRole('option', { name: /^XLSX/ });
  await bulk.getByLabel('단위를 지정할 표').selectOption((await xRange.getAttribute('value'))!);
  await bulk.getByLabel('범위에 적용할 단위').selectOption('만 원');
  await bulk.getByRole('button', { name: '선택 범위에 단위 적용' }).click();
  await expect(bulk).toContainText('4개 항목');
  await page.getByRole('button', { name: '2. 검사 결과', exact: true }).click();
  await expect(panel.locator('.quality-priority')).toContainText('20,000원');
  await expect(panel).toContainText('확인된 오류 0');
});
test('팀원 원본의 잉여금·총자산 차이를 발견하고 미래 자산을 우선 오류처럼 비교하지 않는다', async ({ page }) => {
  test.skip(!process.env.PLANCHECK_TEAM_XLSX || !process.env.PLANCHECK_TEAM_DOCX, '팀원 원본 경로 필요');
  await page.goto('/');
  await page.getByLabel(/검토할 Excel/).setInputFiles(process.env.PLANCHECK_TEAM_XLSX!);
  await page.getByLabel(/검토할 Word/).setInputFiles(process.env.PLANCHECK_TEAM_DOCX!);
  await page.getByRole('button', { name: '검사 시작', exact: true }).click();
  const panel = page.getByRole('region', { name: '자동 검사 결과' }),
    priority = panel.locator('.quality-priority');
  await expect(priority).toContainText('20,000원');
  await expect(priority).toContainText('200,000원');
  await expect(priority).not.toContainText('4,100,000원');
  await expect(priority).not.toContainText('5,000,000원');
  await expect(panel).toContainText('확인된 오류 0');
});
