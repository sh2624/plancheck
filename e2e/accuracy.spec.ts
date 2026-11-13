import { test, expect } from '@playwright/test';
import { accuracyFiles, accuracySheet, accuracyDate, accuracyEnd } from '../tests/accuracy-files';

test('주입한 총자산 차이는 고급 승인 5회 조작으로 확정되고 같은 관계는 재사용한다', async ({ page }, info) => {
  test.skip(!process.env.PLANCHECK_XLSX || !process.env.PLANCHECK_DOCX, '원본 문서 경로 필요');
  const files = await accuracyFiles('CROSS', true);
  await page.goto('/');
  await page.getByLabel(/검토할 Excel/).setInputFiles({
    name: 'evaluation.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(files.xlsx),
  });
  await page.getByLabel(/검토할 Word/).setInputFiles({
    name: 'evaluation.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(files.docx),
  });
  await page.getByRole('button', { name: '검사 시작', exact: true }).click();
  const panel = page.getByRole('region', { name: '자동 검사 결과' });
  await expect(panel.locator('.analysis-count')).not.toBeVisible();
  await expect(panel.getByRole('heading', { name: '우선 확인할 문제', exact: false })).toBeVisible();
  await page.getByLabel('재무 항목', { exact: true }).selectOption('totalAssets');
  await page.locator('.quality-extra > summary').click();
  await page.locator('.quality-records > summary').click();
  await page.locator('.quality-filter-options > summary').click();
  await page.getByLabel('공유 원본 기록 모두 펼치기', { exact: true }).check();
  const card = panel
    .locator('.finding')
    .filter({ hasText: '20만 원' })
    .filter({ hasText: '3,090만 원' })
    .filter({ hasText: '3,070만 원' })
    .filter({ hasText: accuracySheet })
    .first();
  await expect(card).toBeVisible();
  await expect(card).not.toContainText('확인된 오류');
  let actions = 0;
  await card.getByRole('button', { name: '이 항목 검토', exact: true }).click();
  actions++;
  const inline = page.getByRole('region', { name: '선택 항목 상세 검토' });
  await inline.getByLabel('예, 같은 기준입니다.', { exact: true }).check();
  actions++;
  await inline.locator('.review-advanced > summary').click();
  actions++;
  await inline.getByRole('button', { name: '최종 판정 조건 입력' }).click();
  actions++;
  await expect(inline.getByRole('textbox')).toHaveCount(0);
  await inline.getByRole('button', { name: '확인 내용 적용' }).click();
  actions++;
  expect(actions).toBe(5);
  const confirmed = panel.locator('.finding').filter({ hasText: '확인된 오류' }).filter({ hasText: '20만 원' }).first();
  await expect(confirmed).toContainText('총자산');
  await confirmed.getByText('판단 근거 보기', { exact: true }).click();
  await expect(confirmed).toContainText(accuracySheet);
  await expect(confirmed).toContainText('본문 표');
  await confirmed.getByText('판단 근거 보기', { exact: true }).click();
  actions = 0;
  await confirmed.getByRole('button', { name: '확인 내용 수정' }).click();
  actions++;
  await expect(inline.getByLabel('예, 같은 기준입니다.', { exact: true })).toBeChecked();
  await expect(inline).toContainText('이미 승인했습니다');
  await inline.getByRole('button', { name: '답변 저장' }).click();
  actions++;
  expect(actions).toBe(2);
  await page.screenshot({ path: info.outputPath('accuracy-results.png') });
});

for (const kind of ['CALC', 'FUND', 'ACTION', 'ALLOC'] as const) {
  test(`파일 복사본 ${kind}의 수동 확인 경로와 조작 수를 실제 Chrome에서 측정한다`, async ({ page }, info) => {
    test.skip(!process.env.PLANCHECK_XLSX || !process.env.PLANCHECK_DOCX, '원본 문서 경로 필요');
    const files = await accuracyFiles(kind, true);
    await page.goto('/');
    await page.getByLabel(/검토할 Excel/).setInputFiles({
      name: 'evaluation.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(files.xlsx),
    });
    await page.getByLabel(/검토할 Word/).setInputFiles({
      name: 'evaluation.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from(files.docx),
    });
    await page.getByRole('button', { name: '검사 시작', exact: true }).click();
    let operations = 0;
    const act = async (p: Promise<unknown>) => {
      await p;
      operations++;
    };
    const panel = page.getByRole('region', { name: '자동 검사 결과' });
    await expect(panel).toContainText('확인된 오류 0');
    if (kind === 'CALC') {
      const card = panel.locator('.quality-priority .finding').filter({ hasText: '2만 원' }).filter({ hasText: accuracySheet }).first();
      await act(card.getByRole('button', { name: '이 항목 검토', exact: true }).click());
      const detail = page.getByRole('region', { name: '선택 항목 상세 검토' });
      await act(detail.locator('.review-advanced > summary').click());
      await act(detail.getByRole('button', { name: '상세 조건 확인·수정' }).click());
      await act(detail.getByRole('checkbox').check());
      await act(detail.getByRole('button', { name: '선택 값 확인·검증 승인' }).click());
    } else {
      if (kind === 'ALLOC') {
        await act(page.getByRole('button', { name: '3. 상세 검토', exact: true }).click());
        // 현재 원본에서 추출한 자산·두 목표만 확인한다. 새 목표를 만들어 검사하지 않는다.
        await act(page.getByLabel('목록 필터').selectOption('전체'));
        for (const name of ['평가예금', '평가비상자금', '평가의료비']) {
          await act(page.getByLabel('항목 검색').fill(name));
          const row = page.locator('.review-table tbody tr').filter({ hasText: accuracySheet }).first();
          await act(row.getByRole('button', { name: '확인 완료', exact: true }).click());
        }
        await act(page.getByRole('button', { name: '2. 검사 결과', exact: true }).click());
      }
      await act(page.getByText('고급 검사 설정·승인 결과', { exact: true }).click());
      const editor = page.locator('.planning-editor');
      await act(editor.locator(':scope > summary').click());
      if (kind === 'FUND') {
        await act(editor.getByRole('button', { name: /^조건부 금액 \(/ }).click());
        const option = editor.getByLabel('구조화 항목', { exact: true }).getByRole('option', { name: /평가 지원금/ });
        await act(editor.getByLabel('구조화 항목', { exact: true }).selectOption((await option.getAttribute('value'))!));
        await act(editor.getByLabel('현재 반영 검토 기준일').fill(accuracyDate));
        await act(editor.getByLabel('조건부 금액', { exact: true }).fill('132'));
        await act(editor.getByLabel('조건부 금액 단위').selectOption('만 원'));
        await act(editor.getByLabel('지급·가입 승인').selectOption('미승인'));
        await act(editor.getByLabel('실제 수령').selectOption('미수령'));
        await act(editor.getByLabel('계획 반영일').fill(accuracyDate));
        await act(editor.getByLabel('계획 반영처').selectOption('현재 자산'));
        await act(editor.getByLabel('금액 시나리오').fill('기본안'));
        await act(editor.getByRole('checkbox').check());
      } else if (kind === 'ACTION') {
        await act(editor.getByRole('button', { name: /^제안·실행 행동 \(/ }).click());
        for (const side of ['제안', '실행']) {
          const option = editor.getByLabel('구조화 항목', { exact: true }).getByRole('option', { name: new RegExp(`${side}: 평가ETF`) });
          await act(editor.getByLabel('구조화 항목', { exact: true }).selectOption((await option.getAttribute('value'))!));
          await act(editor.getByLabel('대상 ID (동일 행동 대상을 같은 이름으로 연결)').fill('평가ETF'));
          await act(editor.getByLabel('행동 금액 (미기재 가능)').fill('15'));
          await act(editor.getByLabel('행동 금액 단위').selectOption('만 원'));
          await act(editor.getByLabel('행동 시작일').fill(accuracyDate));
          await act(editor.getByLabel('행동 종료일').fill(accuracyEnd));
          await act(editor.getByLabel('행동 시나리오').fill('기본안'));
          await act(editor.getByRole('checkbox').check());
        }
      } else {
        for (const [goal, amount] of [
          ['평가비상자금', '590'],
          ['평가의료비', '300'],
        ]) {
          await act(editor.getByRole('button', { name: '구조화 항목 추가' }).click());
          await act(editor.getByLabel('구조화 항목명').fill(`${goal} 배정`));
          const asset = editor.getByLabel('사용할 보유 자산').getByRole('option', { name: new RegExp(`평가예금.*${accuracySheet}`) });
          const target = editor.getByLabel('연결할 목표액').getByRole('option', { name: new RegExp(`${goal}.*${accuracySheet}`) });
          await act(editor.getByLabel('사용할 보유 자산').selectOption((await asset.getAttribute('value'))!));
          await act(editor.getByLabel('연결할 목표액').selectOption((await target.getAttribute('value'))!));
          await act(editor.getByLabel('배정액', { exact: true }).fill(amount));
          await act(editor.getByLabel('배정 단위').selectOption('만 원'));
          await act(editor.getByLabel('배정 상태').selectOption('확정'));
          await act(editor.getByLabel('자금 구분').selectOption('현재 자산'));
          await act(editor.getByLabel('사용 시작일').fill(accuracyDate));
          await act(editor.getByLabel('사용 종료일').fill(accuracyEnd));
          await act(editor.getByLabel('배정 시나리오').fill('기본안'));
          const ref = editor.getByLabel('원본 문맥 연결').getByRole('option', { name: new RegExp(`평가예금 ${amount}만 원을 ${goal}`) });
          await act(editor.getByLabel('원본 문맥 연결').selectOption((await ref.getAttribute('value'))!));
          await act(editor.getByRole('checkbox').check());
        }
      }
    }
    const error = panel.locator('.quality-priority .finding').filter({ hasText: '확인된 오류' }).first();
    await expect(error).toBeVisible();
    if (kind === 'CALC') await expect(error).toContainText('2만 원');
    if (kind === 'ALLOC') await expect(error).toContainText('300만 원');
    await error.getByText('판단 근거 보기', { exact: true }).click();
    await expect(error).toContainText(kind === 'CALC' ? accuracySheet : 'evaluation.docx');
    console.log('Chrome 조작 측정 ' + JSON.stringify({ kind, operations, scope: '검사 시작 이후, 탐색·입력·확인 포함. 근거 펼치기 제외' }));
    info.annotations.push({ type: 'review-operations', description: `${kind}: ${operations}` });
    if (kind === 'CALC') {
      await error.getByRole('button', { name: '확인 내용 수정' }).click();
      const detail = page.getByRole('region', { name: '선택 항목 상세 검토' });
      await detail.getByLabel('아니요, 구성이 다르거나 빠진 항목이 있습니다.', { exact: true }).check();
      await detail.getByRole('button', { name: '답변 저장' }).click();
      await expect(panel).toContainText('확인된 오류 0');
      await expect(panel.getByRole('status')).toContainText('구성 수정이 필요');
    }
  });
}
