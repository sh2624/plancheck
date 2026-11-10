import { describe, it, expect } from "vitest";
import { item } from "./validation-fixtures";
import { newRecord, emptyPlanning } from "../src/planning/types";
import type {
  Allocation,
  ConditionalFund,
  PlanAction,
} from "../src/planning/types";
import {
  validatePlanning,
  validateActions,
  validateAllocations,
  validateConditionalFunds,
  dateValue,
} from "../src/planning/engine";
import {
  actionOf,
  extractPlanning,
  replacePlanningSource,
} from "../src/planning/extract";
const ref = {
  source: "DOCX" as const,
  fileName: "example.docx",
  location: "본문 표 8 · 2행 3열",
  originalText: "사용자가 확인하는 실제 원문 위치",
};
function allocation(
  id: string,
  goalId: string,
  amount: string,
  patch: Partial<Allocation> = {},
): Allocation {
  return {
    ...newRecord("allocation", id),
    label: `배정 ${id}`,
    assetId: "asset",
    goalId,
    amount,
    unit: "만 원",
    start: "2026-11-01",
    end: "2026-12-31",
    scenario: "기본안",
    certainty: "확정",
    funding: "현재 자산",
    confirmed: true,
    ...patch,
  };
}
function fund(patch: Partial<ConditionalFund> = {}): ConditionalFund {
  return {
    ...newRecord("fund", "f"),
    label: "미확정 지급금",
    amount: "132",
    unit: "만 원",
    certainty: "조건부",
    approval: "미승인",
    received: "미수령",
    reflectedAt: "2026-11-01",
    destination: "현재 자산",
    scenario: "기본안",
    references: [ref],
    confirmed: true,
    ...patch,
  };
}
function action(
  id: string,
  side: PlanAction["side"],
  behavior: PlanAction["action"],
  patch: Partial<PlanAction> = {},
): PlanAction {
  return {
    ...newRecord("action", id),
    label: `계획 ${id}`,
    targetId: "ETF 신규 적립",
    side,
    action: behavior,
    start: "2026-11-01",
    end: "2026-12-31",
    scenario: "기본안",
    references: [ref],
    confirmed: true,
    ...patch,
  };
}
const items = [
  item("asset", "deposit", 5900000, { label: "예금", asOf: "2026-10-31" }),
  item("goal1", "goalAmount", 5900000, { label: "비상자금" }),
  item("goal2", "goalAmount", 3000000, { label: "의료비" }),
];
describe("ALLOC", () => {
  it("590만 원을 590만 원과 300만 원에 동시에 배정하면 오류와 근거를 남긴다", () => {
    const result = validateAllocations(items, [
      allocation("a", "goal1", "590"),
      allocation("b", "goal2", "300"),
    ])[0];
    expect(result.status).toBe("오류");
    expect(result.actual).toBe(8900000);
    expect(result.difference).toBe(3000000);
    expect(result.evidence).toHaveLength(3);
    expect(result.basis).toContain("최대 동시");
  });
  it("이후 새 적립금·순차 사용은 현재 자산의 동시 중복 오류가 아니다", () => {
    const current = allocation("a", "goal1", "590"),
      future = allocation("b", "goal2", "300", {
        funding: "미래 적립금",
        start: "2027-01-01",
        end: "2027-12-31",
      });
    const results = validateAllocations(items, [current, future]);
    expect(results.some((r) => r.status === "오류")).toBe(false);
    expect(results.some((r) => r.status === "확인 필요")).toBe(true);
    expect(
      validateAllocations(items, [
        current,
        { ...future, funding: "현재 자산" },
      ])[0].status,
    ).toBe("검증 통과");
  });
  it("대체 시나리오끼리 합산하지 않는다", () => {
    const results = validateAllocations(items, [
      allocation("a", "goal1", "590"),
      allocation("b", "goal2", "590", { scenario: "대체안" }),
    ]);
    expect(results).toHaveLength(2);
    expect(results.some((r) => r.status === "오류")).toBe(false);
  });
  it.each([1, 73, 4242])("임의 금액 %s과 대상 이름에도 작동한다", (n) => {
    const list = [
      item("asset", "etf", n, { label: "임의 자산-XYZ", asOf: "2026-10-31" }),
      item("goal1", "goalAmount", n),
      item("goal2", "goalAmount", n),
    ];
    expect(
      validateAllocations(list, [
        allocation("a", "goal1", String(n), { unit: "원" }),
        allocation("b", "goal2", String(n), { unit: "원" }),
      ])[0].status,
    ).toBe("오류");
  });
  it("미확인·제외·기간 오류·음수·경계값을 구분한다", () => {
    const a = allocation("a", "goal1", "590");
    expect(validateAllocations(items, [a])[0].status).toBe("검증 통과");
    expect(
      validateAllocations(items, [{ ...a, confirmed: false }])[0].status,
    ).toBe("검증 불가");
    expect(
      validateAllocations(items, [{ ...a, start: "2026-02-30" }])[0].status,
    ).toBe("확인 필요");
    expect(validateAllocations(items, [{ ...a, excluded: true }])).toHaveLength(
      0,
    );
    expect(validateAllocations(items, [{ ...a, amount: "-1" }])[0].status).toBe(
      "검증 불가",
    );
    expect(
      validateAllocations(items, [{ ...a, goalId: "missing" }])[0].needs.join(),
    ).toContain("목표액");
    expect(
      validateAllocations(items, [
        a,
        allocation("b", "goal2", "1", { start: a.end, end: "2027-01-01" }),
      ])[0].status,
    ).toBe("오류");
  });
  it("미래 적립 후보가 있어도 확인된 현재 자산의 초과 배정은 놓치지 않는다", () => {
    const results = validateAllocations(items, [
      allocation("a", "goal1", "590"),
      allocation("b", "goal2", "300"),
      allocation("f", "goal2", "1", {
        funding: "미래 적립금",
        confirmed: false,
      }),
    ]);
    expect(results.some((r) => r.status === "오류")).toBe(true);
  });
});
describe("PLAN 조건부 금액", () => {
  it("승인되지 않은 132만 원의 현재 확정 자산 합산은 오류다", () => {
    const result = validateConditionalFunds([], {
      ...emptyPlanning(),
      asOf: "2026-11-01",
      funds: [fund()],
    })[0];
    expect(result.status).toBe("오류");
    expect(result.actual).toBe(1320000);
    expect(result.references?.[0].location).toContain("2행 3열");
  });
  it("별도 예상 시나리오만 표시하면 오류가 아니다", () => {
    expect(
      validateConditionalFunds([], {
        ...emptyPlanning(),
        funds: [fund({ destination: "예상 시나리오", scenario: "참고안" })],
      })[0].status,
    ).toBe("검증 통과");
  });
  it("승인·수령·기준일이 미확인이거나 상충하면 보류한다", () => {
    for (const patch of [
      { approval: "미확인" as const },
      { received: "미확인" as const },
      { received: "수령" as const },
      { certainty: "미확인" as const },
      { reflectedAt: "2027-01-01" },
    ])
      expect(
        validateConditionalFunds([], {
          ...emptyPlanning(),
          asOf: "2026-11-01",
          funds: [fund(patch)],
        })[0].status,
      ).toBe("확인 필요");
    expect(
      validateConditionalFunds([], {
        ...emptyPlanning(),
        asOf: "2026-11-01",
        funds: [fund({ confirmed: false })],
      })[0].status,
    ).toBe("검증 불가");
  });
  it("확정 승인 수입과 실제 수령을 구별한다", () => {
    const state = { ...emptyPlanning(), asOf: "2026-11-01" };
    expect(
      validateConditionalFunds([], {
        ...state,
        funds: [
          fund({
            certainty: "확정",
            approval: "승인",
            destination: "확정 수입",
          }),
        ],
      })[0].status,
    ).toBe("검증 통과");
    expect(
      validateConditionalFunds([], {
        ...state,
        funds: [
          fund({
            certainty: "확정",
            approval: "승인",
            destination: "현재 자산",
          }),
        ],
      })[0].status,
    ).toBe("확인 필요");
    expect(
      validateConditionalFunds([], {
        ...state,
        funds: [
          fund({ certainty: "확정", approval: "승인", received: "수령" }),
        ],
      })[0].status,
    ).toBe("검증 통과");
  });
  it.each([7, 385, 1024])("임의 지급금 %s에도 동일 규칙을 사용한다", (n) => {
    expect(
      validateConditionalFunds([], {
        ...emptyPlanning(),
        asOf: "2026-11-01",
        funds: [
          fund({ label: "임의 지급금 Z", amount: String(n), unit: "원" }),
        ],
      })[0].status,
    ).toBe("오류");
  });
});
describe("PLAN 제안·실행 충돌", () => {
  it("ETF 중단과 동일 기간 자동이체 유지는 오류다", () => {
    const results = validateActions(
      [],
      [action("p", "제안", "중단"), action("e", "실행", "유지")],
    );
    expect(results[0].status).toBe("오류");
  });
  it("자동이체 중단은 유지가 아니며 같은 중단끼리는 통과한다", () => {
    expect(actionOf("ETF 자동이체 중단")).toBe("중단");
    expect(actionOf("임의펀드 자동이체 중단")).toBe("중단");
    expect(
      validateActions(
        [],
        [
          action("p", "제안", "중단"),
          action("e", "실행", actionOf("ETF 자동이체 중단")),
        ],
      )[0].status,
    ).toBe("검증 통과");
    expect(actionOf("ETF 적립을 중단하지 않는다")).toBe("미확인");
  });
  it("ETF 중단 후 다른 기간 ISA 시작을 충돌로 단정하지 않는다", () => {
    const list = [
      action("p", "제안", "중단"),
      action("e", "실행", "시작", {
        targetId: "ISA 적립",
        start: "2027-01-01",
        end: "2027-12-31",
      }),
    ];
    expect(validateActions([], list).some((r) => r.status === "오류")).toBe(
      false,
    );
    expect(
      validateActions(
        [],
        [list[0], { ...list[1], targetId: list[0].targetId }],
      )[0].status,
    ).toBe("검증 통과");
  });
  it.each(["펀드XYZ", "새 적립계좌", "대상-42"])(
    "임의 대상 %s에서 행동·기간·시나리오를 검사한다",
    (targetId) => {
      const p = action("p", "제안", "중단", { targetId }),
        e = action("e", "실행", "유지", { targetId });
      expect(validateActions([], [p, e])[0].status).toBe("오류");
      expect(
        validateActions([], [p, { ...e, scenario: "대체안" }])[0].status,
      ).toBe("확인 필요");
      expect(
        validateActions([], [p, { ...e, confirmed: false }])[0].status,
      ).toBe("검증 불가");
    },
  );
});
describe("후보와 원본 수명", () => {
  it("자연어 후보는 미확인으로 남기고 파일 교체 시 원본과 함께 지운다", () => {
    const refs = [
      { ...ref, originalText: "제안: 임의펀드 신규 적립 중단" },
      {
        ...ref,
        location: "문단 2",
        originalText: "실행: 임의펀드 자동이체 중단",
      },
      {
        ...ref,
        location: "문단 3",
        originalText: "지원금 132만 원은 조건부이다.",
      },
    ];
    const extracted = extractPlanning(refs),
      state = { ...emptyPlanning(), ...extracted };
    expect(state.actions).toHaveLength(2);
    expect(
      state.actions.every((a) => a.action === "중단" && !a.confirmed),
    ).toBe(true);
    expect(state.funds[0].amount).toBe("132");
    expect(state.funds[0].approval).toBe("미확인");
    expect(validatePlanning([], state).some((r) => r.status === "오류")).toBe(
      false,
    );
    const replacement = replacePlanningSource(state, "DOCX", new Set(), []);
    expect(replacement.actions).toHaveLength(0);
    expect(replacement.funds).toHaveLength(0);
  });
  it("잘못된 날짜를 정규 날짜로 보정하지 않고 입력 객체를 변경하지 않는다", () => {
    expect(dateValue("2026-02-30")).toBeNull();
    expect(dateValue("2028-02-29")).not.toBeNull();
    const state = {
      ...emptyPlanning(),
      allocations: [allocation("a", "goal1", "590")],
    };
    const before = JSON.stringify([state, items]);
    validatePlanning(items, state);
    expect(JSON.stringify([state, items])).toBe(before);
  });
});

it("현재 반영액 0원은 확정 오류 대신 자리표시자 여부를 확인한다", () => {
  expect(
    validateConditionalFunds([], {
      ...emptyPlanning(),
      asOf: "2026-11-01",
      funds: [fund({ amount: "0" })],
    })[0].status,
  ).toBe("확인 필요");
});
it("잘못된 행동 금액 또는 0원 유지 행동은 확정 충돌로 단정하지 않는다", () => {
  for (const patch of [
    { amount: "미정", unit: "만 원" as const },
    { amount: "0", unit: "원" as const },
  ])
    expect(
      validateActions(
        [],
        [action("p", "제안", "중단"), action("e", "실행", "유지", patch)],
      )[0].status,
    ).toBe("확인 필요");
});
it("복수·범위 금액을 단일 지급액으로 자동 확정하지 않는다", () => {
  for (const originalText of [
    "예상 지원금은 100~200만 원이다.",
    "지원금 100만 원과 정부기여금 20만 원이다.",
  ])
    expect(extractPlanning([{ ...ref, originalText }]).funds[0].amount).toBe(
      "",
    );
});
it("원본 ID가 교체되면 연결 배정·조건 항목만 제거하고 다른 원문은 유지한다", () => {
  const state = {
    ...emptyPlanning(),
    allocations: [allocation("a", "goal1", "590")],
    funds: [fund({ references: [], candidateIds: ["asset"] })],
    actions: [action("p", "제안", "중단")],
  };
  const next = replacePlanningSource(state, "XLSX", new Set(["asset"]), []);
  expect(next.allocations).toHaveLength(0);
  expect(next.funds).toHaveLength(0);
  expect(next.actions).toHaveLength(1);
});
