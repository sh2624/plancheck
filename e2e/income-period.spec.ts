import { test, expect } from '@playwright/test';

test('실제 월·연 소득을 같은 기간의 값처럼 표시하지 않는다', async ({ page }) => {
  test.skip(!process.env.PLANCHECK_NEWLYWED_XLSX || !process.env.PLANCHECK_NEWLYWED_DOCX, '실제 문서 경로 필요');
  await page.goto('/');
  await page.getByLabel(/검토할 Excel/).setInputFiles(process.env.PLANCHECK_NEWLYWED_XLSX!);
  await page.getByLabel(/검토할 Word/).setInputFiles(process.env.PLANCHECK_NEWLYWED_DOCX!);
  await page.getByRole('button', { name: '검사 시작', exact: true }).click();
  const results = page.getByRole('region', { name: '자동 검사 결과' });
  await expect(results).toBeVisible();
  await expect(results.locator('.quality-priority')).not.toContainText('7,700만 원');
  await expect(results.locator('.quality-priority')).not.toContainText('310만 원 다릅니다');
  await expect(results.locator('.quality-priority')).not.toContainText('390만 원 다릅니다');
  await expect(results).toContainText('확인된 오류 0');
});
