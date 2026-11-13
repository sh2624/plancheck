import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const x = process.env.PLANCHECK_TEAM_XLSX,
  d = process.env.PLANCHECK_TEAM_DOCX;
/** 실제 팀원 문서로만 검사하고 외부 전송 요청은 차단한다. */
async function inspect(page: Page) {
  test.skip(!x || !d, '실제 팀원 문서 경로 필요');
  await page.route('**/*', (route) => (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort()));
  await page.goto('/');
  await page.getByLabel(/검토할 Excel/).setInputFiles(x!);
  await page.getByLabel(/검토할 Word/).setInputFiles(d!);
  await expect(page.getByText('두 문서가 준비됐습니다', { exact: true })).toBeVisible();
  await expect(page.locator('.inspection-results')).toHaveCount(0);
  await page.getByRole('button', { name: '검사 시작', exact: true }).click();
  const panel = page.getByRole('region', { name: '자동 검사 결과' });
  await expect(panel).toContainText('확인된 오류 0');
  return panel;
}
test('실제 다섯 결과의 요약·접힌 근거·노트북과 모바일 화면을 확인한다', async ({ page }) => {
  const panel = await inspect(page),
    priority = panel.locator('.quality-priority');
  await expect(priority.locator(':scope > .finding')).toHaveCount(5);
  const allocation = priority.locator('[data-review-kind="allocation"]'),
    fund = priority.locator('[data-review-kind="fund"]'),
    action = priority.locator('[data-review-kind="action"]');
  await expect(priority).toContainText('2만 원');
  await expect(priority).toContainText('20만 원');
  await expect(allocation).toContainText('590만 원');
  await expect(allocation).toContainText('890만 원');
  await expect(allocation).toContainText('300만 원 부족');
  await expect(fund).toContainText('132만 원');
  await expect(fund).toContainText('정부기여금');
  await expect(fund).toContainText('금액 미확인');
  await expect(action).toContainText('4단계 · 제안');
  await expect(action).toContainText('5단계 · 실행');
  await expect(action.locator('.finding-values')).toContainText('월 15만 원');
  for (const card of [allocation, fund, action]) {
    await expect(card.locator('.finding-proof')).not.toHaveAttribute('open', '');
    await expect(card.getByRole('button', { name: '확인할 수 없습니다.', exact: true })).toHaveCount(0);
    await expect(card.locator(':scope > .finding-description')).not.toContainText('본문 문단');
    await card.getByText('판단 근거 보기', { exact: true }).click();
    await expect(card.locator('.finding-proof .finding-evidence').first()).toBeVisible();
    await expect(card.locator('.finding-proof')).toContainText('검증 규칙');
    await card.getByText('판단 근거 보기', { exact: true }).click();
  }
  mkdirSync('.cache/results-ux', { recursive: true });
  for (const [width, height, name] of [
    [1280, 900, 'results-laptop'],
    [390, 844, 'results-mobile'],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.cache/results-ux/${name}.png`, fullPage: true });
  }
  await allocation.getByRole('button', { name: '이 항목 검토', exact: true }).click();
  const choices = page.locator('.compound-choices button');
  await expect(choices).toHaveCount(3);
  const bounds = await choices.evaluateAll((elements) =>
    elements.map((el) => {
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
    }),
  );
  expect(bounds.every((b, i) => b.left >= 0 && b.right <= 390 && (!i || b.top >= bounds[i - 1].bottom))).toBe(true);
  await page.screenshot({ path: '.cache/results-ux/review-mobile.png', fullPage: true });
  await page.getByRole('region', { name: '선택 항목 상세 검토', exact: true }).getByRole('button', { name: '닫기', exact: true }).click();
  await panel.locator('.quality-extra > summary').click();
  await expect(panel.locator('.quality-extra [data-review-kind]')).toHaveCount(0);
  await panel.locator('.quality-records > summary').click();
  await expect(panel.getByRole('region', { name: '상세 분석 기록', exact: true })).toBeVisible();
});
for (const [kind, choice, label, response] of [
  ['allocation', 'same', '예, 같은 예금을 동시에 사용합니다.', '같은 자금·동시 사용이라는 답변을 기록했습니다.'],
  ['allocation', 'different', '아니요, 다른 자금이나 사용 시점입니다.', '다른 자금 또는 시점으로 보류했습니다.'],
  ['allocation', 'unknown', '확인할 수 없습니다.', '자금·사용 시점을 확인할 수 없어 보류했습니다.'],
  ['fund', 'same', '예, 조건과 반영 시점이 확인됐습니다.', '조건·시점에 대한 답변을 기록했습니다.'],
  ['fund', 'different', '아니요, 아직 확정되지 않았습니다.', '아직 확정되지 않았다는 답변으로 보류했습니다.'],
  ['fund', 'unknown', '확인할 수 없습니다.', '지급·수령 조건과 반영 시점을 확인할 수 없어 보류했습니다.'],
  ['action', 'same', '예, 같은 ETF와 기간입니다.', '같은 상품·기간이라는 답변을 기록했습니다.'],
  ['action', 'different', '아니요, 상품이나 적용 기간이 다릅니다.', '다른 상품 또는 적용 기간으로 보류했습니다.'],
  ['action', 'unknown', '확인할 수 없습니다.', '상품·기간을 확인할 수 없어 보류했습니다.'],
] as const)
  test(`실제 ${kind} ${choice} 응답은 기존 검토 상태만 바꾸고 오류를 확정하지 않는다`, async ({ page }) => {
    const panel = await inspect(page),
      card = panel.locator(`.quality-priority [data-review-kind="${kind}"]`);
    await card.getByRole('button', { name: '이 항목 검토', exact: true }).click();
    await page.getByRole('region', { name: '선택 항목 상세 검토', exact: true }).getByRole('button', { name: label, exact: true }).click();
    await expect(panel.locator('.compound-feedback')).toContainText(response);
    await expect(panel.locator('.compound-feedback')).toBeInViewport();
    await expect(panel).toContainText('확인된 오류 0');
    await expect(panel.locator(`.finding[data-review-kind="${kind}"]`)).toHaveCount(1);
    if (choice !== 'same') await expect(card).toHaveCount(0);
    await panel.locator('.compound-feedback').getByRole('button', { name: '이 답변 다시 검토' }).click();
    await expect(
      page.getByRole('region', { name: '선택 항목 상세 검토', exact: true }).getByRole('button', { name: label, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
