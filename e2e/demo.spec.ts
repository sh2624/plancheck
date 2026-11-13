import { openAdvanced, openSources } from './workflow';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { basename } from 'node:path';
const xlsx = process.env.PLANCHECK_XLSX,
  docx = process.env.PLANCHECK_DOCX;
const table = (page: Page) => page.locator('.results > .table-scroll');
async function upload(page: Page) {
  await page.goto('/');
  await page.getByLabel(/검토할 Excel/).setInputFiles(xlsx!);
  await page.getByLabel(/검토할 Word/).setInputFiles(docx!);
  await openSources(page);
  await expect(page.getByText(`원본: ${basename(xlsx!)}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`원본: ${basename(docx!)}`)).toBeVisible();
}
async function recommend(page: Page, pattern: RegExp) {
  const root = page.locator('details.recommendation-center');
  if ((await root.getAttribute('open')) === null) await root.locator('summary').first().click();
  await page.getByLabel('추천 종류').selectOption('CROSS');
  await root.getByRole('button', { name: pattern }).click();
  return page.getByRole('region', { name: '추천 근거 검토' });
}
async function approve(region: Locator) {
  await region.getByRole('checkbox').check();
  await region.getByRole('button', { name: '선택 값 확인·검증 승인' }).click();
}
async function metadata(row: Locator, prefix = '') {
  await row.getByLabel(`${prefix}기준일`, { exact: true }).fill('2026-10-31');
  await row.getByLabel(`${prefix}시나리오`, { exact: true }).fill('동일 기준 검토 (사용자 확인 시연)');
  await row.getByLabel(`${prefix}확정 여부`).selectOption('확정');
}
function audit(page: Page) {
  const errors: string[] = [],
    requests: { url: string; method: string }[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method() }));
  return () => {
    expect(errors).toEqual([]);
    expect(requests.every((r) => r.url.startsWith('http://127.0.0.1:4173/') && ['GET', 'HEAD'].includes(r.method))).toBe(true);
  };
}

test('자료 없는 화면은 결과 수를 표시하지 않고 문서 등록으로 안내한다', async ({ page }) => {
  const check = audit(page);
  await page.goto('/');
  await expect(page.getByText(/Excel 수식은 재계산하지 않습니다/)).toBeVisible();
  await openAdvanced(page);
  await expect(page.getByText(/아직 검사할 문서가 없습니다/)).toBeVisible();
  await expect(page.getByRole('button', { name: '오류 0', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '검수 결과', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '문서 등록하기', exact: true }).click();
  await expect(page.getByLabel(/검토할 Excel/)).toBeFocused();
  await expect(page.getByRole('button', { name: '검사 시작', exact: true })).toBeDisabled();
  check();
});

test.describe('제공된 실제 문서 시연', () => {
  test.skip(!xlsx || !docx, 'PLANCHECK_XLSX와 PLANCHECK_DOCX에 로컬 샘플 경로를 지정하세요.');
  test('업로드·확인 전 보류·금리와 잔액 차이·원본 근거·파일 교체 초기화', async ({ page }, info) => {
    const check = audit(page);
    await upload(page);
    await openAdvanced(page);
    await expect(page.getByRole('button', { name: '오류 0', exact: true })).toBeVisible();
    const credit = await recommend(page, /^CROSS ·.*신용대출.*금리/);
    await expect(credit.getByLabel('추천 숫자').nth(0)).toHaveValue('7.5');
    await expect(credit.getByLabel('추천 숫자').nth(1)).toHaveValue('6.5');
    await approve(credit);
    const pending = table(page).getByRole('button', {
      name: /신용대출.*CROSS_VALUE/,
    });
    await expect(pending).toBeVisible();
    await expect(page.getByRole('button', { name: '오류 0', exact: true })).toBeVisible();
    await pending.click();
    let detail = page.getByRole('region', { name: '검증 근거 상세' });
    await expect(detail).toContainText('확인 필요');
    await expect(detail).toContainText('1 %p');
    await detail.getByRole('button', { name: '문서 내용 확인·수정' }).click();
    const review = page.getByRole('region', { name: '데이터 확인' });
    const rows = review.locator('.review-table tbody tr');
    await expect(rows).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      const row = rows.nth(i);
      await row.getByText('상세 편집', { exact: true }).click();
      await metadata(row);
      await row.getByRole('button', { name: '확인 완료', exact: true }).click();
    }
    await openAdvanced(page);
    await approve(await recommend(page, /^CROSS ·.*신용대출.*금리/));
    const creditError = table(page).getByRole('button', {
      name: /신용대출 금리가 1\.0%p 차이 납니다/,
    });
    await expect(creditError).toBeVisible();
    await creditError.click();
    detail = page.getByRole('region', { name: '검증 근거 상세' });
    await expect(detail).toContainText(basename(xlsx!));
    await expect(detail).toContainText(basename(docx!));
    await expect(detail).toContainText('!');
    await expect(detail).toContainText(/본문 (문단|표)/);
    await detail.screenshot({ path: info.outputPath('credit-proof.png') });
    // 준비 중 필터에서 승인해도 새 오류가 보이는 판정 결과로 복귀해야 한다.
    await page.getByRole('button', { name: /^검증 불가 \d+$/ }).click();
    const student = await recommend(page, /^CROSS ·.*학자금대출.*잔액/);
    await expect(student.getByLabel('추천 숫자').nth(0)).toHaveValue('700');
    await expect(student.getByLabel('추천 숫자').nth(1)).toHaveValue('701.5');
    for (const row of await student.locator('tbody tr').all()) await metadata(row, '추천 ');
    await approve(student);
    const studentError = table(page).getByRole('button', {
      name: /학자금대출 잔액이 두 문서에서 다릅니다/,
    });
    await expect(studentError).toBeVisible();
    await expect(page.getByLabel('결과 필터')).toHaveValue('판정 결과');
    await studentError.click();
    detail = page.getByRole('region', { name: '검증 근거 상세' });
    await expect(detail).toContainText('15,000 원');
    await expect(detail).toContainText(basename(xlsx!));
    await expect(detail).toContainText(basename(docx!));
    await detail.screenshot({ path: info.outputPath('student-proof.png') });
    await page.screenshot({
      path: info.outputPath('results-desktop.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: '1. 검사 시작' }).click();
    await page.getByLabel(/검토할 Excel/).setInputFiles(xlsx!);
    await openSources(page);
    await expect(page.getByText(`원본: ${basename(xlsx!)}`, { exact: true })).toBeVisible();
    await openAdvanced(page);
    await expect(table(page).getByRole('button', { name: /CROSS_VALUE/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '오류 0', exact: true })).toBeVisible();
    check();
  });

  test('실제 예금·적금 보유액을 여러 시연 목표에 동시에 배정하면 오류를 표시한다', async ({ page }, info) => {
    const check = audit(page);
    await upload(page);
    await page.getByRole('button', { name: /3. 상세 검토/ }).click();
    await page.getByLabel('목록 필터').selectOption('DOCX');
    await page.getByLabel('항목 검색').fill('유동성 자산 · 예금·적금');
    let row = page.locator('.review-table tbody tr');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('590만 원');
    await row.getByText('상세 편집', { exact: true }).click();
    await row.getByLabel('기준일', { exact: true }).fill('2026-10-31');
    await row.getByLabel('시나리오', { exact: true }).fill('중복 배정 시연');
    await row.getByLabel('확정 여부').selectOption('확정');
    await row.getByRole('button', { name: '확인 완료', exact: true }).click();
    // 목표는 원문 추출이라고 가장하지 않고 사용자가 직접 추가한 시연 입력이다.
    for (const [name, amount] of [
      ['시연 비상자금', '590'],
      ['시연 의료비', '300'],
    ]) {
      await page.getByRole('button', { name: '항목 직접 추가' }).click();
      row = page.locator('.review-table tbody tr').first();
      await row.getByLabel('항목명', { exact: true }).fill(name);
      await row.getByLabel('항목 유형').selectOption('goalAmount');
      await row.getByLabel('숫자', { exact: true }).fill(amount);
      await row.getByLabel('단위').selectOption('만 원');
      await row.getByLabel('시나리오', { exact: true }).fill('중복 배정 시연');
      await row.getByLabel('확정 여부').selectOption('확정');
      await row.getByRole('button', { name: '확인 완료', exact: true }).click();
    }
    await openAdvanced(page);
    const recommendations = page.locator('details.recommendation-center');
    await page.getByLabel('추천 종류').selectOption('ALLOC');
    await recommendations.getByRole('button', { name: /ALLOC · 자산별 목표 배정 관계 확인/ }).click();
    await page.getByRole('button', { name: '구조화 조건 확인으로 이동' }).click();
    const editor = page.locator('details.planning-editor');
    const assetId = await editor
      .getByLabel('사용할 보유 자산')
      .getByRole('option', { name: /유동성 자산 · 예금·적금/ })
      .getAttribute('value');
    expect(assetId).toBeTruthy();
    for (const [index, goal, amount] of [
      [0, '시연 비상자금', '590'],
      [1, '시연 의료비', '300'],
    ] as const) {
      if (index) await editor.getByRole('button', { name: '구조화 항목 추가' }).click();
      await editor.getByLabel('구조화 항목명').fill(`${goal} 배정`);
      await editor.getByLabel('사용할 보유 자산').selectOption(assetId!);
      const goalId = await editor
        .getByLabel('연결할 목표액')
        .getByRole('option', { name: new RegExp(`^${goal}`) })
        .getAttribute('value');
      await editor.getByLabel('연결할 목표액').selectOption(goalId!);
      await editor.getByLabel('배정액', { exact: true }).fill(amount);
      await editor.getByLabel('배정 단위').selectOption('만 원');
      await editor.getByLabel('배정 상태').selectOption('확정');
      await editor.getByLabel('자금 구분').selectOption('현재 자산');
      await editor.getByLabel('사용 시작일').fill('2026-11-01');
      await editor.getByLabel('사용 종료일').fill('2026-12-31');
      await editor.getByLabel('배정 시나리오').fill('중복 배정 시연');
      await editor.getByRole('checkbox').check();
    }
    const error = table(page).getByRole('button', {
      name: /예금·적금이 여러 목표에 중복 배정됐습니다/,
    });
    await expect(error).toBeVisible();
    await error.click();
    const detail = page.getByRole('region', { name: '검증 근거 상세' });
    await expect(detail).toContainText('8,900,000 원');
    await expect(detail).toContainText('5,900,000 원');
    await expect(detail).toContainText('3,000,000 원');
    await expect(detail).toContainText(basename(docx!));
    await expect(detail).toContainText('직접 입력');
    await detail.screenshot({ path: info.outputPath('allocation-proof.png') });
    check();
  });
});
