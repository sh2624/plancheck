import { test, expect, type Page } from '@playwright/test';
import { basename } from 'node:path';
const xlsx = process.env.PLANCHECK_XLSX,
  docx = process.env.PLANCHECK_DOCX;
const panel = (page: Page) => page.getByRole('region', { name: '자동 검사 결과' });
const selected = (page: Page) => page.getByRole('region', { name: '선택 항목 상세 검토' });
const creditIn = (page: Page, section: string) =>
  page
    .getByRole('region', { name: section, exact: true })
    .locator('.finding')
    .filter({
      has: page.getByRole('heading', { name: /신용대출 금리.*1\.0%p/ }),
    })
    .first();
test('인라인 예·아니요·미확인과 원본 편집이 실제 판정·연결 승인에 일관되게 반영된다', async ({ page }, info) => {
  test.skip(!xlsx || !docx, '실제 로컬 문서 경로가 필요합니다.');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel(/검토할 Excel/).setInputFiles(xlsx!);
  await page.getByLabel(/검토할 Word/).setInputFiles(docx!);
  await page.getByRole('button', { name: '검사 시작', exact: true }).click();
  let card = creditIn(page, '우선 검토');
  await expect(card).toBeVisible();
  await expect(card.locator('.finding-values')).toContainText('7.5%');
  await expect(card.locator('.finding-values')).toContainText('6.5%');
  await expect(card.getByText(basename(xlsx!), { exact: false })).not.toBeVisible();
  await card.getByRole('button', { name: '이 항목 검토', exact: true }).click();
  await selected(page).getByLabel('아니요, 다른 조건입니다.', { exact: true }).check();
  await selected(page).getByRole('button', { name: '확인 내용 적용' }).click();
  card = creditIn(page, '상세 분석 기록');
  await expect(card).toContainText('다른 조건 · 보류');
  await expect(card).toContainText('1.0%p');
  await expect(panel(page)).toContainText('확정 오류 0');
  await card.getByRole('button', { name: '이 항목 검토', exact: true }).click();
  await selected(page).getByLabel('확인할 수 없습니다.', { exact: true }).check();
  await selected(page).getByRole('button', { name: '확인 내용 적용' }).click();
  await expect(card).toContainText('확인 불가 · 보류');
  await expect(panel(page)).toContainText('확정 오류 0');
  await card.getByRole('button', { name: '이 항목 검토', exact: true }).click();
  await selected(page).getByLabel('예, 같은 기준입니다.', { exact: true }).check();
  await selected(page).getByRole('button', { name: '확인 내용 적용' }).click();
  await expect(selected(page).getByRole('alert')).toContainText('공통 기준일');
  await expect(panel(page)).toContainText('확정 오류 0');
  await selected(page).getByLabel('공통 기준일', { exact: true }).fill('2026-10-31');
  await selected(page).getByLabel('공통 시나리오', { exact: true }).fill('원문을 같은 기준으로 확인한 시연');
  await selected(page).getByRole('button', { name: '확인 내용 적용' }).click();
  card = page
    .getByRole('region', { name: '우선 검토', exact: true })
    .locator('.finding')
    .filter({
      has: page.getByRole('heading', { name: /신용대출 금리.*추가 확인/ }),
    })
    .first();
  await expect(card).toContainText('사용자 확인 후 · 확인 필요');
  await expect(panel(page)).toContainText('확정 오류 0');
  await card.getByRole('button', { name: '확인 내용 수정' }).click();
  await expect(selected(page).getByLabel('예, 같은 기준입니다.', { exact: true })).toBeChecked();
  await selected(page).getByLabel('예, 같은 기준입니다.', { exact: true }).check();
  await expect(selected(page).getByLabel('공통 기준일', { exact: true })).toHaveCount(0);
  await selected(page).getByRole('checkbox').check();
  await selected(page).getByRole('button', { name: '확인 내용 적용' }).click();
  card = page
    .getByRole('region', { name: '우선 검토', exact: true })
    .locator('.finding')
    .filter({
      has: page.getByRole('heading', {
        name: '신용대출 금리가 1.0%p 차이 납니다.',
        exact: true,
      }),
    });
  await expect(card).toContainText('사용자 확인 후 · 오류');
  await expect(panel(page)).toContainText('확정 오류 1');
  await card.screenshot({ path: info.outputPath('inline-confirmed.png') });
  await page.getByText('고급 검사 설정·승인 결과', { exact: true }).click();
  await expect(page.getByRole('region', { name: '검수 결과', exact: true })).toContainText('승인 연결 1개');
  await page.getByText('고급 검사 설정·승인 결과', { exact: true }).click();
  await card.getByText('판단 근거 보기', { exact: true }).click();
  await expect(card).toContainText(basename(xlsx!));
  await expect(card).toContainText(basename(docx!));
  await expect(card).toContainText('CROSS_VALUE');
  await card.getByRole('button', { name: '관련 원본·데이터 수정' }).click();
  const row = page
    .getByRole('region', { name: '데이터 확인', exact: true })
    .locator('.review-table tbody tr')
    .filter({ hasText: 'XLSX' })
    .first();
  await row.getByText('상세 편집', { exact: true }).click();
  await row.getByLabel('숫자', { exact: true }).fill('6.5');
  await page.getByRole('button', { name: '2. 검사 결과' }).click();
  await expect(panel(page)).toContainText('확정 오류 0');
  await expect(panel(page)).toContainText('신용대출 금리 수치가 일치하는 후보');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('results-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('results-laptop.png') });
  expect(errors).toEqual([]);
});
