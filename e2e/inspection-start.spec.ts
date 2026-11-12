import { test, expect } from '@playwright/test';
/** 실제 팀원 파일을 등록하고 검사 시작 한 번으로 승인 없이 다섯 대상을 확인한다. */
test('파일 준비 후 검사 시작 한 번으로 다섯 검토 대상을 표시한다', async ({ page }) => {
  const x = process.env.PLANCHECK_TEAM_XLSX,
    d = process.env.PLANCHECK_TEAM_DOCX;
  test.skip(!x || !d, '실제 팀원 파일 필요');
  const sent: string[] = [];
  await page.route('**/*', (route) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
      sent.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto('/');
  await page.getByLabel(/검토할 Excel/).setInputFiles(x!);
  await expect(page.locator('.inspection-results')).toHaveCount(0);
  await page.getByLabel(/검토할 Word/).setInputFiles(d!);
  await expect(page.getByText('두 문서가 준비됐습니다', { exact: true })).toBeVisible();
  await expect(page.locator('.inspection-results')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('재무설계 문서 검사');
  await page.getByRole('button', { name: '검사 시작', exact: true }).click();
  const panel = page.getByRole('region', { name: '자동 검사 결과' }),
    priority = panel.locator('.quality-priority');
  await expect(priority).toContainText('20,000원');
  await expect(priority).toContainText('200,000원');
  await expect(priority).toContainText('같은 예금의 배정액');
  await expect(priority).toContainText('3,000,000원');
  await expect(priority).toContainText('ETF 중단 제안과 유지 실행');
  await expect(priority).toContainText('월세 세액공제');
  await expect(priority).toContainText('1,320,000원');
  await expect(panel).toContainText('확인된 오류 0');
  await expect(page.getByRole('region', { name: '데이터 확인', exact: true })).toHaveCount(0);
  await expect(page.getByText('선택형 AI 문맥 분석 · Preview 실험', { exact: true })).toHaveCount(0);
  const action = priority.locator('.finding').filter({ has: page.getByRole('heading', { name: /ETF 중단 제안과 유지 실행/ }) });
  await expect(action).toContainText('본문 문단 11');
  await expect(action).toContainText('본문 문단 13');
  await action.getByRole('button', { name: '예, 같은 관계입니다.', exact: true }).click();
  await expect(action.getByRole('button', { name: '예, 같은 관계입니다.', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel).toContainText('확인된 오류 0');
  await page.getByRole('button', { name: '2. 검사 결과', exact: true }).click();
  await expect(action.getByRole('button', { name: '예, 같은 관계입니다.', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // 모르는 조건은 단 한 번의 답변으로 보류하며 확정 오류를 만들지 않는다.
  for (const title of [/ETF 중단 제안과 유지 실행/, /같은 예금의 배정액/, /월세 세액공제 예상액/]) {
    const card = priority.locator('.finding').filter({ has: page.getByRole('heading', { name: title }) });
    await card.getByRole('button', { name: '확인할 수 없습니다.', exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(panel).toContainText('확인된 오류 0');
  }
  console.log('팀원 원본: 검사 시작 1회, 항목·연결 승인 0회, 복합 관계 보류 답변 각 1회.');
  await page.getByRole('button', { name: '1. 검사 시작', exact: true }).click();
  await page.getByRole('button', { name: 'Word 보고서 초기화' }).click();
  await expect(panel).toHaveCount(0);
  expect(sent).toEqual([]);
});
