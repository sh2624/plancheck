import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
test('AFPK 실제 두 파일에서 연간 계산 차이와 자산 차이를 추가 승인 없이 발견한다', async ({ page }) => {
  const x = process.env.PLANCHECK_AFPK_XLSX,
    d = process.env.PLANCHECK_AFPK_DOCX;
  test.skip(!x || !d, '비공개 AFPK 원본 경로 필요');
  const before = [readFileSync(x!), readFileSync(d!)];
  const sent: string[] = [];
  await page.route('**/*', (r) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(r.request().method())) {
      sent.push(r.request().url());
      return r.abort();
    }
    return r.continue();
  });
  await page.goto('/');
  await page.getByLabel(/검토할 Excel/).setInputFiles(x!);
  await page.getByLabel(/검토할 Word/).setInputFiles(d!);
  await expect(page.getByText('등록 완료 · 추출됨', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('region', { name: '자동 검사 결과' })).toHaveCount(0);
  await page.getByRole('button', { name: '검사 시작', exact: true }).click();
  const panel = page.getByRole('region', { name: '자동 검사 결과' });
  await expect(panel).toContainText('확인된 오류 0');
  await expect(panel.locator('.quality-priority > .finding')).toHaveCount(2);
  await expect(panel.locator('.quality-extra > summary')).toContainText('0건');
  const annual = panel
    .locator('.quality-priority > .finding')
    .filter({ has: page.getByRole('heading', { name: /연간 순현금흐름/ }) })
    .first();
  await expect(annual.locator('.finding-comparison')).toContainText('120만 원');
  await annual.getByText('판단 근거 보기', { exact: true }).click();
  await expect(annual.locator('.finding-proof')).toContainText('4800000');
  await expect(annual.locator('.finding-proof')).toContainText('49200000');
  await expect(annual.locator('.finding-proof')).toContainText('본문 문단 7');
  const assets = panel
    .locator('.quality-priority > .finding')
    .filter({ has: page.getByRole('heading', { name: /총자산/ }) })
    .first();
  await expect(assets.locator('.finding-comparison')).toContainText('3,000만 원');
  await assets.getByText('판단 근거 보기', { exact: true }).click();
  await expect(assets.locator('.finding-proof')).toContainText('순자산 = 총자산 − 총부채');
  await assets.locator('.discovery-supports > summary').click();
  const composition = assets
    .locator('.finding-support')
    .filter({ has: page.getByRole('heading', { name: /총자산 합계의 문서값과 추천 계산값/ }) });
  await expect(composition).toHaveCount(1);
  await expect(composition.locator('.finding-values')).toContainText('23,000만 원');
  await expect(composition.locator('.finding-values')).toContainText('20,000만 원');
  await expect(composition.locator('.finding-values')).not.toContainText('입출금통장');
  await expect(composition).toContainText('입출금통장');
  await expect(assets.locator('.finding-support').filter({ has: page.getByRole('heading', { name: /순자산/ }) })).toHaveCount(2);
  await expect(page.getByText('선택형 AI 문맥 분석 · Preview 실험', { exact: true })).toHaveCount(0);
  expect(sent).toEqual([]);
  expect(readFileSync(x!).equals(before[0])).toBe(true);
  expect(readFileSync(d!).equals(before[1])).toBe(true);
});
