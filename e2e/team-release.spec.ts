import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { JSDOM } from 'jsdom';
import { parseXlsx } from '../src/parsers/xlsx';
import { parseDocx } from '../src/parsers/docx';
import { extractWorkbook, extractWord } from '../src/normalization/extract';
import { inspectDocuments } from '../src/inspection/analyze';
import { emptyPlanning } from '../src/planning/types';
import { workbookReferences, wordReferences } from '../src/planning/extract';

/** 실제 파일의 위치·원문을 동적으로 대조하며 원본과 서버 데이터는 수정하지 않는다. */
test('팀원 전달본은 설정 없이 두 차이와 실제 원본 근거를 표시하고 AI를 노출하지 않는다', async ({ page }) => {
  const xlsx = process.env.PLANCHECK_TEAM_XLSX,
    docx = process.env.PLANCHECK_TEAM_DOCX;
  test.skip(!xlsx || !docx, '실제 팀원 파일 경로 필요');
  const originalX = readFileSync(xlsx!),
    originalD = readFileSync(docx!);
  Object.defineProperty(globalThis, 'DOMParser', { value: new JSDOM('').window.DOMParser, configurable: true });
  const buffer = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  const book = await parseXlsx(buffer(originalX), basename(xlsx!)),
    word = await parseDocx(buffer(originalD), basename(docx!));
  const items = [...extractWorkbook(book), ...extractWord(word)];
  const findings = inspectDocuments({
    items,
    links: [],
    calculations: [],
    planning: emptyPlanning(),
    references: [...workbookReferences(book), ...wordReferences(word)],
  });
  const compact = (s: string) => s.replace(/\s/g, '');
  const blocked: string[] = [];
  await page.route('**/*', (route) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
      blocked.push(new URL(route.request().url()).pathname);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto('/');
  await page.getByLabel(/검토할 Excel/).setInputFiles(xlsx!);
  await page.getByLabel(/검토할 Word/).setInputFiles(docx!);
  await page.getByRole('button', { name: '검사 시작', exact: true }).click();
  const panel = page.getByRole('region', { name: '자동 검사 결과' }),
    priority = panel.locator('.quality-priority');
  await expect(priority).toContainText('2만 원');
  await expect(priority).toContainText('20만 원');
  await expect(panel).toContainText('확인된 오류 0');
  await expect(page.getByText('선택형 AI 문맥 분석 · Preview 실험', { exact: true })).toHaveCount(0);
  // 같은 발견의 별도 문서 비교 기록을 실제 클릭으로 연다. 연결 승인은 하지 않는다.
  for (const related of await priority.locator('details.related-findings').all()) {
    if ((await related.getAttribute('open')) === null) await related.locator(':scope > summary').click();
  }
  for (const [field, label, difference] of [
    ['surplus', '잉여금', 20000],
    ['totalAssets', '총자산', 200000],
  ] as const) {
    const card = priority
      .locator('.finding:visible')
      .filter({ has: page.locator('.finding-values').filter({ hasText: label }) })
      .filter({ has: page.locator('.finding-values').filter({ hasText: 'Excel' }) })
      .filter({ has: page.locator('.finding-values').filter({ hasText: 'Word' }) })
      .first();
    await expect(card).toBeVisible();
    await card.getByText('판단 근거 보기', { exact: true }).click();
    const proof = compact(await card.locator('.finding-proof').innerText());
    const matching = findings.filter(
      (f) => f.kind === 'CROSS' && f.result.evidence.every((c) => c.field === field) && Math.abs(f.result.difference ?? 0) === difference,
    );
    expect(
      matching.some(
        (f) =>
          f.result.evidence.every(
            (c) => proof.includes(compact(c.fileName)) && proof.includes(compact(c.location)) && proof.includes(compact(c.originalText)),
          ) && proof.includes(compact(f.result.basis)),
      ),
    ).toBe(true);
  }
  const surplus = priority.locator('.finding').filter({ has: page.locator('.finding-values').filter({ hasText: '잉여금' }) });
  await expect(surplus).toHaveCount(1);
  await surplus.locator('.discovery-supports > summary').click();
  await expect(surplus.locator('.finding-support')).toHaveCount(1);
  await expect(surplus.locator('.finding-support')).toContainText('CROSS_VALUE');
  await panel.locator('.quality-extra > summary').click();
  const extra = page.getByRole('region', { name: '추가 검토', exact: true });
  await expect(extra.locator('.finding').filter({ has: page.locator('.finding-values').filter({ hasText: '잉여금' }) })).toHaveCount(0);
  // 동일 차이의 Word 표·문단 근거를 대표 발견 안에 각각 보존한다.
  const assetCards = panel
    .locator('.quality-priority .finding, .quality-extra .finding')
    .filter({ has: page.locator('.finding-values').filter({ hasText: '총자산' }) });
  await expect(assetCards).toHaveCount(1);
  await assetCards.locator('.discovery-supports > summary').click();
  await expect(assetCards.locator('.finding-support')).toHaveCount(2);
  await expect(
    assetCards.locator('.finding-support').filter({ has: page.locator('.finding-values').filter({ hasText: '총자산' }) }),
  ).toHaveCount(1);
  await expect(assetCards.locator('.finding-support').filter({ has: page.getByRole('heading', { name: /순자산/ }) })).toHaveCount(1);
  await expect(assetCards.locator('.finding-proof')).toContainText('순자산 = 총자산 − 총부채');
  await expect(assetCards.locator('.finding-proof')).toContainText('본문 표 1');
  await expect(assetCards.locator('.finding-proof')).toContainText('본문 문단 4');
  expect(blocked).toEqual([]);
  expect(readFileSync(xlsx!).equals(originalX)).toBe(true);
  expect(readFileSync(docx!).equals(originalD)).toBe(true);
});
