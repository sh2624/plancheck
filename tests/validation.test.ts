import { describe, it, expect } from "vitest";
import {
  annuityPayment,
  validateCalculation,
  validateCross,
  validateAll,
} from "../src/validation/engine";
import { newCalculation } from "../src/validation/types";
import { item, calculation } from "./validation-fixtures";
describe("계산 규칙", () => {
  it.each(["assets", "debt"] as const)(
    "%s 합계 정상·오류·허용오차 경계",
    (rule) => {
      const field = rule === "assets" ? "deposit" : "loanBalance",
        total = rule === "assets" ? "totalAssets" : "totalDebt";
      const inputs = [
        item("a", field, 40),
        item("b", field, 60),
        item("t", total, 100),
      ];
      const spec = calculation(rule, "t", { parts: ["a", "b"] });
      expect(validateCalculation(inputs, spec).status).toBe("검증 통과");
      expect(
        validateCalculation(
          [...inputs.slice(0, 2), item("t", total, 101)],
          spec,
        ).status,
      ).toBe("검증 통과");
      const error = validateCalculation(
        [...inputs.slice(0, 2), item("t", total, 102)],
        spec,
      );
      expect(error.status).toBe("오류");
      expect(error.difference).toBe(2);
      expect(error.evidence[0].location).toContain("시트!");
    },
  );
  it("순자산은 총자산에서 총부채를 뺀다", () => {
    const values = [
      item("a", "totalAssets", 1000),
      item("d", "totalDebt", 1200),
      item("n", "netAssets", -200),
    ];
    const spec = calculation("net", "n", { assets: ["a"], debt: ["d"] });
    expect(validateCalculation(values, spec).status).toBe("검증 통과");
    expect(
      validateCalculation(
        [...values.slice(0, 2), item("n", "netAssets", 200)],
        spec,
      ).status,
    ).toBe("오류");
  });
  it("월 잉여금은 지출과 저축을 각각 차감하며 0원도 유지한다", () => {
    const values = [
      item("i", "income", 100),
      item("e", "fixedExpense", 100),
      item("s", "savings", 0),
      item("t", "surplus", 0),
    ];
    const spec = calculation("surplus", "t", {
      income: ["i"],
      expense: ["e"],
      savings: ["s"],
    });
    expect(validateCalculation(values, spec).status).toBe("검증 통과");
    expect(
      validateCalculation(
        values.map((c) => (c.id === "t" ? item("t", "surplus", 9) : c)),
        spec,
      ).status,
    ).toBe("오류");
    expect(
      validateCalculation(
        values.map((c) => (c.id === "i" ? { ...c, period: "연간" } : c)),
        spec,
      ).status,
    ).toBe("확인 필요");
  });
  it("누락·미확인·제외·부적합 단위·중복을 확정 판정하지 않는다", () => {
    const values = [item("a", "deposit", 10), item("t", "totalAssets", 30)];
    const spec = calculation("assets", "t", { parts: ["a"] });
    for (const patch of [
      { confirmed: false },
      { excluded: true },
      { unit: "%" as const },
      { number: "", normalizedValue: null },
    ])
      expect(
        validateCalculation([{ ...values[0], ...patch }, values[1]], spec)
          .status,
      ).toBe("검증 불가");
    expect(
      validateCalculation(values, {
        ...spec,
        groups: { parts: ["missing"] },
      }).needs.join(),
    ).toContain("원본 항목 없음");
    expect(
      validateCalculation(values, { ...spec, groups: { parts: ["a", "a"] } })
        .status,
    ).toBe("검증 불가");
    expect(validateCalculation(values, { ...spec, groups: {} }).status).toBe(
      "검증 불가",
    );
    expect(validateCalculation(values, { ...spec, tolerance: "" }).status).toBe(
      "검증 불가",
    );
  });
  it("범위 미확인·시점 차이·가정·문서 혼합은 확인 필요다", () => {
    const values = [item("a", "deposit", 10), item("t", "totalAssets", 30)];
    const spec = calculation("assets", "t", { parts: ["a"] });
    expect(
      validateCalculation(values, { ...spec, scopeConfirmed: false }).status,
    ).toBe("확인 필요");
    for (const patch of [
      { asOf: "" },
      { asOf: "2027" },
      { scenario: "대체안" },
      { certainty: "가정" as const },
      { source: "DOCX" as const, fileName: "report.docx" },
    ])
      expect(
        validateCalculation([{ ...values[0], ...patch }, values[1]], spec)
          .status,
      ).toBe("확인 필요");
  });
  it("필요 없는 미확인 후보는 선택한 검증을 막지 않으며 입력은 변하지 않는다", () => {
    const values = [
      item("a", "deposit", 10),
      item("t", "totalAssets", 10),
      item("unused", "income", 99, { confirmed: false }),
    ];
    const before = JSON.stringify(values);
    expect(
      validateAll(values, [], [calculation("assets", "t", { parts: ["a"] })])[0]
        .status,
    ).toBe("검증 통과");
    expect(JSON.stringify(values)).toBe(before);
    expect(
      validateCalculation([], newCalculation("net", "empty")).needs.length,
    ).toBeGreaterThan(0);
  });
});
describe("원리금균등 대출", () => {
  const inputs = [
    item("p", "loanPrincipal", 1000000),
    item("r", "loanRate", 12),
    item("n", "loanTerm", 12),
    item("t", "loanPayment", 88849),
  ];
  const spec = calculation(
    "loan",
    "t",
    { principal: ["p"], rate: ["r"], term: ["n"] },
    {
      loanMethod: "원리금균등",
      loanBasis: "최초 원금·전체 기간",
      graceMonths: "0",
    },
  );
  it("약정 계산과 무이자·1개월 경계를 처리한다", () => {
    expect(annuityPayment(1000000, 12, 12)).toBeCloseTo(88848.788678, 5);
    expect(annuityPayment(120, 0, 12)).toBe(10);
    expect(annuityPayment(100, 12, 1)).toBeCloseTo(101);
    expect(validateCalculation(inputs, spec).status).toBe("검증 통과");
    expect(
      validateCalculation(
        [...inputs.slice(0, 3), item("t", "loanPayment", 90000)],
        spec,
      ).status,
    ).toBe("오류");
  });
  it("현재 잔액과 잔여 기간, 년·개월을 지원한다", () => {
    const values = [
      item("p", "loanBalance", 1000000),
      item("r", "loanRate", 12),
      item("n", "loanTerm", 1, { unit: "년" }),
      item("t", "loanPayment", 88849),
    ];
    expect(
      validateCalculation(values, { ...spec, loanBasis: "현재 잔액·잔여 기간" })
        .status,
    ).toBe("검증 통과");
  });
  it("거치·상환방식·기간 기준 미확인은 계산값을 제시하지 않는다", () => {
    for (const patch of [
      { graceMonths: "" },
      { graceMonths: "3" },
      { loanMethod: "기타" as const },
      { loanBasis: "미확인" as const },
      { loanBasis: "현재 잔액·잔여 기간" as const },
    ]) {
      const result = validateCalculation(inputs, { ...spec, ...patch });
      expect(result.status).toBe("확인 필요");
      expect(result.expected).toBeNull();
    }
  });
  it("0개월·음수 금리·소수 개월·과도한 숫자는 검증 불가다", () => {
    expect(annuityPayment(100, 2, 0)).toBeNull();
    expect(annuityPayment(100, -1, 12)).toBeNull();
    expect(annuityPayment(100, 1, 1.5)).toBeNull();
    expect(annuityPayment(Infinity, 1, 12)).toBeNull();
    expect(
      validateCalculation(
        inputs.map((c) => (c.id === "n" ? item("n", "loanTerm", 0) : c)),
        spec,
      ).status,
    ).toBe("검증 불가");
  });
});
describe("승인 연결 교차 검증", () => {
  const x = item("x", "income", 3150000),
    d = item("d", "income", 3150000, {
      source: "DOCX",
      fileName: "report.docx",
      location: "본문 표 2 · 3행 2열",
    }),
    links = [{ id: "l", xlsxId: "x", docxId: "d" }];
  it("원·만 원을 같은 원 단위로 비교하고 실제 불일치와 근거를 남긴다", () => {
    expect(
      validateCross([x, { ...d, number: "315", unit: "만 원" }], links)[0]
        .status,
    ).toBe("검증 통과");
    const result = validateCross(
      [x, item("d", "income", 3160000, { source: "DOCX" })],
      links,
    )[0];
    expect(result.status).toBe("오류");
    expect(result.difference).toBe(-10000);
    expect(result.evidence).toHaveLength(2);
  });
  it("금리 및 기간을 비교한다", () => {
    expect(
      validateCross(
        [
          item("x", "loanRate", 7.5),
          item("d", "loanRate", 6.5, { source: "DOCX" }),
        ],
        links,
      )[0].difference,
    ).toBe(1);
    expect(
      validateCross(
        [
          item("x", "loanTerm", 12),
          item("d", "loanTerm", 1, { source: "DOCX", unit: "년" }),
        ],
        links,
      )[0].status,
    ).toBe("검증 통과");
  });
  it("기준일·시나리오·월연 차이는 값이 달라도 확인 필요다", () => {
    for (const patch of [
      { asOf: "2027" },
      { scenario: "대체안" },
      { period: "연간" },
      { asOf: "" },
      { certainty: "조건부" as const },
    ])
      expect(
        validateCross(
          [x, { ...d, ...patch, number: "3160000", normalizedValue: 3160000 }],
          links,
        )[0].status,
      ).toBe("확인 필요");
  });
  it("미확인·누락·단위 불일치·유형 차이는 통과나 오류로 단정하지 않는다", () => {
    expect(
      validateCross([x, { ...d, confirmed: false }], links)[0].status,
    ).toBe("검증 불가");
    expect(validateCross([x], links)[0].status).toBe("검증 불가");
    expect(validateCross([x, { ...d, unit: "%" }], links)[0].status).toBe(
      "검증 불가",
    );
    expect(
      validateCross([x, { ...d, field: "surplus" }], links)[0].status,
    ).toBe("확인 필요");
    expect(validateCross([x, d], [])).toHaveLength(0);
  });
});

it("안전한 숫자 범위를 넘는 합계와 차이는 통과시키지 않는다", () => {
  const max = Number.MAX_SAFE_INTEGER;
  const values = [
    item("a", "deposit", max),
    item("b", "etf", max),
    item("t", "totalAssets", 0),
  ];
  expect(
    validateCalculation(
      values,
      calculation("assets", "t", { parts: ["a", "b"] }),
    ).status,
  ).toBe("검증 불가");
  expect(
    validateCalculation(
      [
        item("a", "totalAssets", max),
        item("d", "totalDebt", max),
        item("t", "netAssets", 0),
      ],
      calculation("net", "t", { assets: ["a"], debt: ["d"] }),
    ).status,
  ).toBe("검증 통과");
});
