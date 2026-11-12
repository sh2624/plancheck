import { test, expect } from '@playwright/test';
import { basename } from 'node:path';
const xlsx = process.env.PLANCHECK_XLSX,
  docx = process.env.PLANCHECK_DOCX;
test('검사 시작만으로 차이를 발견하고 선택 검토 후에만 확정 오류로 구분한다', async ({ page }, info) => {
  test.skip(!xlsx || !docx, '제공된 로컬 문서 경로가 필요합니다.');
  const errors: string[] = [],
    requests: { url: string; method: string }[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method() }));
  await page.goto('/');
  const start = page.getByRole('button', { name: '검사 시작', exact: true });
  await expect(start).toBeDisabled();
  await expect(page.locator('.optional-help')).not.toHaveAttribute('open', '');
  await page.getByLabel(/검토할 Excel/).setInputFiles(xlsx!);
  await expect(start).toBeDisabled();
  await page.getByLabel(/검토할 Word/).setInputFiles(docx!);
  await expect(start).toBeEnabled();
  await expect(page.locator('.document-advanced[open]')).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath('inspection-start.png'),
    fullPage: true,
  });
  await expect(page.getByLabel('숫자', { exact: true })).toHaveCount(0);
  await start.click();
  const results = page.getByRole('region', { name: '자동 검사 결과' });
  await expect(results).toContainText('확인된 오류 0');
  let credit = results.locator('.finding').filter({
    has: page.getByRole('heading', { name: /신용대출 금리.*1.0%p/ }),
  });
  await expect(credit).toHaveCount(1);
  await expect(credit).toContainText('검사 중 발견 · 확인 필요');
  await expect(credit).toContainText('7.5%');
  await expect(credit).toContainText('6.5%');
  const student = results.locator('.finding').filter({
    has: page.getByRole('heading', { name: /학자금대출 잔액.*15,000원/ }),
  });
  await expect(student).toBeVisible();
  await credit.getByText('판단 근거 보기', { exact: true }).click();
  await expect(credit).toContainText(basename(xlsx!));
  await expect(credit).toContainText(basename(docx!));
  await expect(credit).toContainText('기준일');
  await expect(credit).toContainText('시나리오');
  await credit.screenshot({ path: info.outputPath('automatic-credit.png') });
  await credit.getByRole('button', { name: '이 항목 검토' }).click();
  let detail = page.getByRole('region', { name: '선택 항목 상세 검토' });
  await expect(detail).toContainText('동일한 대출');
  await detail.getByRole('button', { name: '고급 편집·개별 승인' }).click();
  await expect(detail.getByLabel('추천 숫자')).toHaveCount(2);
  await detail.getByRole('checkbox').check();
  await detail.getByRole('button', { name: '선택 값 확인·검증 승인' }).click();
  credit = results
    .locator('.finding')
    .filter({ has: page.getByRole('heading', { name: /신용대출 금리/ }) })
    .first();
  await expect(credit).toContainText('비교 기준 확인됨 · 확인 필요');
  await expect(results).toContainText('확인된 오류 0');
  await credit.getByRole('button', { name: '확인 내용 수정' }).click();
  detail = page.getByRole('region', { name: '선택 항목 상세 검토' });
  await detail.getByRole('button', { name: '고급 편집·개별 승인' }).click();
  for (const row of await detail.locator('tbody tr').all()) {
    await row.getByLabel('추천 기준일', { exact: true }).fill('2026-10-31');
    await row.getByLabel('추천 시나리오', { exact: true }).fill('사용자가 동일 기준으로 확인한 시연');
    await row.getByLabel('추천 확정 여부').selectOption('확정');
  }
  await detail.getByRole('checkbox').check();
  await detail.getByRole('button', { name: '선택 값 확인·검증 승인' }).click();
  await expect(results).toContainText('확인된 오류 1');
  const final = results.locator('.finding').filter({
    has: page.getByRole('heading', {
      name: '신용대출 금리가 1.0%p 차이 납니다.',
      exact: true,
    }),
  });
  await expect(final).toContainText('확인된 오류');
  await final.screenshot({ path: info.outputPath('confirmed-credit.png') });
  await page.getByRole('button', { name: '1. 검사 시작' }).click();
  await page.getByLabel(/검토할 Excel/).setInputFiles(xlsx!);
  await expect(page.getByText('등록 완료 · 추출됨', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: '2. 검사 결과' }).click();
  // 파일 교체 후 이전 승인은 사라지고 새 파일의 미승인 자동 발견을 다시 표시한다.
  await expect(results).toContainText('확인된 오류 0');
  await expect(results.locator('.quality-priority .finding').first()).toBeVisible();
  expect(errors).toEqual([]);
  expect(requests.every((r) => r.url.startsWith('http://127.0.0.1:4173/') && r.method === 'GET')).toBe(true);
});
