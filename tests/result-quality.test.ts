import { it, expect } from "vitest";
import { item } from "./validation-fixtures";
import { discoverCross, validateCross } from "../src/validation/engine";
import {
  reviewQuality,
  filterQuality,
  exactFindingKey,
  qualityTiers,
} from "../src/inspection/quality";
import { assessRelationship } from "../src/normalization/relationships";
import { suggestLinks } from "../src/normalization/links";
import { inspectDocuments, type Finding } from "../src/inspection/analyze";
import { emptyPlanning } from "../src/planning/types";
import { recommend } from "../src/recommendations/recommend";
import { applyRecommendation } from "../src/recommendations/apply";
import { applyInlineReview } from "../src/inspection/review";
function pair(
  field: Parameters<typeof item>[1] = "loanRate",
  x = 7.5,
  d = 6.5,
) {
  return [
    item("x", field, x, {
      label: field === "loanRate" ? "신용대출 금리" : field,
      confirmed: false,
    }),
    item("d", field, d, {
      source: "DOCX",
      label: field === "loanRate" ? "신용대출 금리" : field,
      location: "본문 표 1 · 2행",
      confirmed: false,
    }),
  ];
}
function finding(id = "f", items = pair()): Finding {
  const recommendation = {
    id,
    kind: "CROSS" as const,
    title: "원문 비교",
    candidateIds: items.map((c) => c.id),
    link: { xlsxId: items[0].id, docxId: items[1].id },
    reason: "동일 항목 명칭과 단위",
    risks: [],
    missing: [],
    confidence: "구조 일치" as const,
    primary: true,
    references: [],
  };
  return {
    id,
    kind: "CROSS",
    title: "수치 차이",
    signal: "수치 차이",
    primary: true,
    recommendation,
    questions: ["동일 기준인가요?"],
    result: discoverCross(items, [{ id, ...recommendation.link }])[0],
  };
}
it("같은 원본 쌍·관계·근거의 완전 중복만 합치고 원래 기록 ID를 남긴다", () => {
  const f = finding(),
    duplicate = {
      ...f,
      id: "duplicate",
      result: { ...f.result, id: "other-result" },
    };
  expect(exactFindingKey(f)).toBe(exactFindingKey(duplicate));
  const quality = reviewQuality([f, duplicate]);
  expect(quality).toHaveLength(1);
  expect(quality[0].occurrences.map((f) => f.id)).toEqual(["f", "duplicate"]);
});
it("다른 원본 위치나 계산 근거는 합쳐 삭제하지 않고 파생 기록으로 보존한다", () => {
  const f = finding(),
    sameValueElsewhere = finding(
      "elsewhere",
      pair().map((c) => ({ ...c, location: `다른 위치 ${c.location}` })),
    ),
    otherBasis = {
      ...f,
      id: "other-basis",
      result: { ...f.result, basis: "별도 적용 범위의 근거" },
    };
  const quality = reviewQuality([f, sameValueElsewhere, otherBasis]);
  expect(quality).toHaveLength(3);
  expect(quality.filter((q) => q.tier === "우선 검토")).toHaveLength(1);
  expect(quality[0].supportCount).toBe(2);
  expect(
    new Set(quality.flatMap((q) => q.occurrences.map((f) => f.id))).size,
  ).toBe(3);
});
it("차이 크기보다 핵심 항목·원본 관계를 우선하고 필터는 판정을 바꾸지 않는다", () => {
  const core = finding(),
    expense = finding(
      "large",
      pair("fixedExpense", 900000000, 1).map((c) => ({
        ...c,
        label: "보험료",
      })),
    ),
    quality = reviewQuality([expense, core]);
  expect(quality[0].finding.id).toBe(core.id);
  expect(quality[1].tier).toBe("추가 검토");
  expect(filterQuality(quality, "loanRate")).toEqual([quality[0]]);
  expect(filterQuality(quality, "fixedExpense", "CALC")).toHaveLength(0);
});
it.each([
  { asOf: "2028-01-01" },
  { scenario: "다른 계획" },
  { period: "연간" },
])("명시된 기준 조건이 다른 값은 우선 불일치로 올리지 않는다: %j", (patch) => {
  const items = pair("income", 500, 600);
  items[1] = { ...items[1], ...patch };
  const f = finding("context", items);
  expect(reviewQuality([f])[0].tier).toBe("상세 분석 기록");
  expect(f.result.status).not.toBe("오류");
});
it("현재 잔액과 미래 연도 계획을 구분하고 연간 흐름은 월간 핵심 검토와 분리한다", () => {
  const items = pair("loanBalance", 500, 900).map((c) => ({
    ...c,
    label: "신용대출 잔액",
  }));
  items[1].period = "2031";
  expect(reviewQuality([finding("future", items)])[0].tier).toBe(
    "상세 분석 기록",
  );
  expect(
    reviewQuality([
      finding(
        "annual",
        pair("surplus", 20, 50).map((c) => ({ ...c, period: "연간" })),
      ),
    ])[0].tier,
  ).toBe("추가 검토");
});
it.each([
  ["deposit", "예금", "적금"],
  ["etf", "예금 + ETF", "ETF"],
  ["fixedExpense", "월세", "월세 / 관리비·공과금"],
  ["loanPayment", "신용대출 상환방식", "신용대출 월 상환액"],
] as const)(
  "다른 세부 항목과 묶음·코드를 같은 항목으로 승인하지 않는다: %s",
  (field, x, d) => {
    const items = pair(field, 111, 111);
    items[0].label = x;
    items[1].label = d;
    expect(assessRelationship(items[0], items[1]).blocked).toBe(true);
    expect(suggestLinks(items, [])).toHaveLength(0);
    const f = finding("bad", items),
      state = { items, links: [], calculations: [] };
    expect(applyRecommendation(state, f.recommendation!, true)).toBe(state);
    expect(applyInlineReview(state, f.recommendation!, "same").ok).toBe(false);
    const records = inspectDocuments({
      ...state,
      planning: emptyPlanning(),
      references: [],
    });
    expect(
      records.every(
        (f) =>
          f.result.difference === null &&
          !f.recommendation?.link &&
          !f.approved,
      ),
    ).toBe(true);
  },
);
it("사용자 승인 후 확정 오류는 갱신되지만 수치 일치 후보를 자동 통과로 바꾸지 않는다", () => {
  const f = finding(),
    state = { items: f.result.evidence, links: [], calculations: [] },
    approved = applyRecommendation(state, f.recommendation!, true),
    result = validateCross(approved.items, approved.links)[0];
  expect(reviewQuality([{ ...f, approved: result }])[0].tier).toBe("우선 검토");
  expect(result.status).toBe("오류");
  const same = finding("same", pair("loanRate", 7, 7));
  same.signal = "수치 일치";
  const quality = reviewQuality([same]);
  expect(quality[0].tier).toBe(qualityTiers[2]);
  expect(quality[0].finding.approved).toBeUndefined();
});
it("자동 월 잉여금 구성은 명시적 지출 총합을 중복 합산하지 않고 미분류 저축은 보류한다", () => {
  const row = (
    id: string,
    field: Parameters<typeof item>[1],
    value: number,
    label: string,
  ) =>
    item(id, field, value, {
      label,
      source: "DOCX",
      fileName: "sheet.docx",
      location: `본문 표 1 · ${id}행`,
      period: "월간",
      confirmed: false,
    });
  const items = [
      row("t", "surplus", 70000, "월 잉여금"),
      row("i", "income", 3150000, "월 실수령"),
      row("f", "fixedExpense", 1505000, "고정지출 소계"),
      row("v", "variableExpense", 950000, "변동지출 소계"),
      row(
        "g",
        "variableExpense",
        2730000,
        "생활비 합계 · 고정 + 변동 + 부채상환",
      ),
      row("p", "loanPayment", 184000, "신용대출 월 상환액"),
      row("s", "savings", 150000, "ETF 적립"),
      {
        ...row("a", "deposit", 200000, "적금"),
        originalText: "저축·투자 | 적금 | 20",
      },
    ],
    input = {
      items,
      links: [],
      calculations: [],
      planning: emptyPlanning(),
      references: [],
    },
    before = JSON.stringify(input),
    r = recommend(items, [], input.planning, []).find(
      (r) => r.calculation?.rule === "surplus",
    )!;
  expect(r.calculation!.groups.expense).toEqual(["g"]);
  expect(r.scopeIssues?.length).toBeGreaterThan(0);
  expect(applyRecommendation(input, r, true)).toBe(input);
  const f = inspectDocuments(input).find(
    (f) => f.result.code === "CALC_SURPLUS",
  )!;
  expect(f.result).toMatchObject({
    status: "검증 불가",
    expected: null,
    difference: null,
  });
  expect(JSON.stringify(input)).toBe(before);
});
