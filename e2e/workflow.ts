import { expect, type Page } from '@playwright/test';
export async function openAdvanced(page: Page) {
  await page.getByRole('button', { name: '2. 검사 결과' }).click();
  const root = page.locator('.advanced-workspace');
  if ((await root.getAttribute('open')) === null) await root.locator(':scope > summary').click();
}
export async function openSources(page: Page) {
  await expect(page.getByText('등록 완료 · 추출됨', { exact: true })).toHaveCount(2);
  for (const details of await page.locator('.document-advanced').all())
    if ((await details.getAttribute('open')) === null) await details.locator(':scope > summary').click();
}
