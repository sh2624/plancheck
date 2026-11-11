import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('베타 화면은 긴 파일명·본문을 1280px와 390px에서 읽을 수 있고 개인정보 안내를 등록 화면에 한 번만 표시한다', async ({
  page,
}, info) => {
  test.skip(!process.env.PLANCHECK_XLSX || !process.env.PLANCHECK_DOCX, '실제 문서 경로 필요');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.getByText('브라우저 내 처리', { exact: true })).toHaveCount(0);
  const privacy = page.getByText('선택한 문서는 브라우저 안에서만 처리하며 외부로 전송하지 않습니다.', { exact: true });
  await expect(privacy).toBeVisible();
  await expect(privacy).toHaveCount(1);
  const xname = '장기재무설계_검토자료_'.repeat(6) + '최종.xlsx',
    dname = '상담보고서_문서검토_'.repeat(6) + '최종.docx';
  await page.getByLabel(/검토할 Excel/).setInputFiles({
    name: xname,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: readFileSync(process.env.PLANCHECK_XLSX!),
  });
  await page.getByLabel(/검토할 Word/).setInputFiles({
    name: dname,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: readFileSync(process.env.PLANCHECK_DOCX!),
  });
  await expect(page.locator('.file-line').filter({ hasText: xname })).toBeVisible();
  await expect(page.locator('.file-line').filter({ hasText: dname })).toBeVisible();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const sizes = await page.evaluate(() => ({
      title: parseFloat(getComputedStyle(document.querySelector('h1')!).fontSize),
      button: parseFloat(getComputedStyle(document.querySelector('.inspection-start button')!).fontSize),
      font: getComputedStyle(document.body).fontFamily,
    }));
    expect(sizes.title).toBeGreaterThanOrEqual(22);
    expect(sizes.title).toBeLessThanOrEqual(24);
    expect(sizes.button).toBeGreaterThanOrEqual(14);
    expect(sizes.font).toContain('Pretendard');
    await page.screenshot({ path: info.outputPath(`upload-${width}.png`) });
  }
  await page.getByRole('button', { name: '검사 시작', exact: true }).click();
  await expect(privacy).toHaveCount(0);
  const panel = page.getByRole('region', { name: '자동 검사 결과' });
  await expect(panel).toContainText('확인된 오류 0');
  const card = panel.locator('.quality-priority .finding').filter({ hasText: '신용대출 금리' }).first();
  await expect(card).toContainText('검사 중 발견 · 확인 필요');
  await expect(card).toContainText('1.0%p');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await card.getByText('판단 근거 보기', { exact: true }).click();
    await expect(card).toContainText(xname);
    await expect(card).toContainText(dname);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const button = card.getByRole('button', { name: '이 항목 검토', exact: true });
    await page.keyboard.press('Tab');
    await button.focus();
    await expect(button).toBeFocused();
    const visual = await button.evaluate((el) => ({
      size: parseFloat(getComputedStyle(el).fontSize),
      height: el.getBoundingClientRect().height,
      outline: getComputedStyle(el).outlineStyle,
    }));
    expect(visual.size).toBeGreaterThanOrEqual(14);
    expect(visual.height).toBeGreaterThanOrEqual(40);
    expect(visual.outline).not.toBe('none');
    await card.screenshot({ path: info.outputPath(`result-proof-${width}.png`) });
    await card.getByText('판단 근거 보기', { exact: true }).click();
  }
  expect(errors).toEqual([]);
});
