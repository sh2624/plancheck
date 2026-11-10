import { openAdvanced, openSources } from "./workflow";
import { test, expect } from "@playwright/test";
import { basename } from "node:path";
const xlsx = process.env.PLANCHECK_XLSX,
  docx = process.env.PLANCHECK_DOCX;
test("선택 안내와 고급 경로에서 실제 두 문서 등록과 핵심 항목 확인까지 이동한다", async ({
  page,
}, info) => {
  test.skip(!xlsx || !docx, "실제 로컬 문서 경로가 필요합니다.");
  await page.goto("/");
  await page.locator(".optional-help > summary").click();
  const guide = page.getByRole("complementary", { name: "단계 안내" }),
    next = page.getByRole("complementary", { name: "다음 행동" });
  await expect(guide).toContainText("두 문서를 등록하세요");
  await guide.getByRole("button", { name: "안내 닫기" }).click();
  await guide.getByRole("button", { name: "안내 다시 보기" }).click();
  await expect(guide).toContainText("주의");
  await next.getByRole("button", { name: "Excel 등록" }).click();
  await expect(page.getByLabel(/검토할 Excel/)).toBeFocused();
  await page.getByLabel(/검토할 Excel/).setInputFiles(xlsx!);
  await page
    .getByText("추출 요약·원본 보기 · Excel 재무표", { exact: true })
    .click();
  await expect(
    page.getByText(`원본: ${basename(xlsx!)}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Excel 재무표" }).locator(".file-line"),
  ).toContainText(basename(xlsx!));
  await next.getByRole("button", { name: "Word 등록" }).click();
  await expect(page.getByLabel(/검토할 Word/)).toBeFocused();
  await page.getByLabel(/검토할 Word/).setInputFiles(docx!);
  await openSources(page);
  await expect(
    next.getByRole("button", { name: "데이터 확인으로 이동" }),
  ).toBeVisible();
  await expect(
    page.getByText("등록 완료 · 추출됨", { exact: true }),
  ).toHaveCount(2);
  await expect(page.locator(".original-details[open]")).toHaveCount(0);
  await page
    .getByText("원본 상세 보기 · Excel 재무표", { exact: true })
    .click();
  await expect(
    page.getByRole("columnheader", { name: "셀 위치" }),
  ).toBeVisible();
  await page
    .getByText("원본 상세 보기 · Excel 재무표", { exact: true })
    .click();
  await page.screenshot({
    path: info.outputPath("registration.png"),
    fullPage: true,
  });
  await next.getByRole("button", { name: "데이터 확인으로 이동" }).click();
  await expect(guide).toContainText("검증에 필요한 값만 확인하세요");
  await expect(page.getByLabel("목록 필터")).toHaveValue("핵심 확인");
  await expect(page.locator(".review-progress")).toContainText(
    "핵심 확인 진행",
  );
  await page.getByLabel("목록 필터").selectOption("전체");
  await next.getByRole("button", { name: "핵심 확인 항목으로 이동" }).click();
  await expect(page.getByLabel("목록 필터")).toHaveValue("관련 항목");
  const review = page.getByRole("region", { name: "데이터 확인" });
  await expect(review).toBeFocused();
  await expect(
    review.getByLabel("숫자", { exact: true }).first(),
  ).not.toBeVisible();
  await page.screenshot({
    path: info.outputPath("core-review.png"),
    fullPage: true,
  });
  await openAdvanced(page);
  await expect(guide).toContainText("차이와 원본 근거를 검토하세요");
  await expect(page.getByLabel("결과 필터")).toHaveValue("판정 결과");
  await expect(
    page.getByRole("button", { name: "오류 0", exact: true }),
  ).toBeVisible();
  await page.locator(".preparation-list > summary").click();
  await page
    .locator(".preparation-list")
    .getByRole("button", { name: "필요한 항목 확인" })
    .first()
    .click();
  await expect(
    page.getByRole("region", { name: "추천 근거 검토" }),
  ).toBeVisible();
});
