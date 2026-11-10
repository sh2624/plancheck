import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
  waitFor,
} from "@testing-library/react";
import App from "../src/App";
import { ReviewView } from "../src/components/ReviewView";
import { ResultsView } from "../src/components/ResultsView";
import {
  coreCandidates,
  reviewProgress,
  candidateValue,
} from "../src/presentation/workflow";
import { item, calculation } from "./validation-fixtures";
import { validateAll } from "../src/validation/engine";
import { newCalculation } from "../src/validation/types";
afterEach(cleanup);
it("금리 표시 잡음을 줄여도 원본 숫자와 작은 금리 값은 보존한다", () => {
  const c = item("r", "loanRate", 1.7000000000000002);
  expect(candidateValue(c)).toBe("1.7 %");
  expect(c.number).toBe("1.7000000000000002");
  expect(candidateValue({ ...c, number: "0.000001" })).toBe("0.000001 %");
  expect(candidateValue({ ...c, number: "" })).toBe("값 미확인 %");
});
it("추천이 없는 계산 준비 항목은 실제 계산 구성 편집 위치를 연다", () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "3. 검수 결과" }));
  fireEvent.click(screen.getByText(/검증 준비 중 5건/));
  fireEvent.click(
    screen.getAllByRole("button", { name: "필요한 항목 확인" })[0],
  );
  expect(
    document.querySelector<HTMLDetailsElement>(".calculation-settings")?.open,
  ).toBe(true);
  expect(document.activeElement?.getAttribute("data-calculation")).toBe(
    "assets",
  );
});
it("각 단계 안내를 처음 표시하고 단계별 닫기 상태와 다시 열기를 유지한다", () => {
  render(<App />);
  const guide = () => screen.getByRole("complementary", { name: "단계 안내" });
  expect(guide().textContent).toContain("두 문서를 등록하세요");
  fireEvent.click(within(guide()).getByRole("button", { name: "안내 닫기" }));
  expect(guide().textContent).not.toContain("두 문서를 등록하세요");
  fireEvent.click(screen.getByRole("button", { name: /2. 데이터 확인/ }));
  expect(guide().textContent).toContain("검증에 필요한 값만 확인하세요");
  fireEvent.click(screen.getByRole("button", { name: "3. 검수 결과" }));
  expect(guide().textContent).toContain("차이와 원본 근거를 검토하세요");
  fireEvent.click(screen.getByRole("button", { name: "1. 문서 등록" }));
  fireEvent.click(
    within(guide()).getByRole("button", { name: "안내 다시 보기" }),
  );
  expect(guide().textContent).toContain("두 문서를 등록하세요");
  expect(
    screen
      .getByRole("button", { name: "1. 문서 등록" })
      .getAttribute("aria-current"),
  ).toBe("step");
});
it("어느 단계에서도 누락 파일 등록 위치로 이동하고 초점을 맞춘다", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "3. 검수 결과" }));
  const next = screen.getByRole("complementary", { name: "다음 행동" });
  expect(next.textContent).toContain("Excel 재무표가 없습니다");
  fireEvent.click(within(next).getByRole("button", { name: "Excel 등록" }));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText(/검토할 Excel/)),
  );
});
it("핵심 추천 후보와 수동 입력만 우선하며 제외값과 누락값을 확인 완료로 세지 않는다", () => {
  const items = [
    item("a", "income", 100),
    item("b", "goalName", 0, {
      number: "",
      normalizedValue: null,
      confirmed: false,
    }),
    item("c", "unknown", 0, {
      number: "",
      normalizedValue: null,
      method: "직접 입력",
      confirmed: false,
    }),
    item("d", "loanRate", 1, { excluded: true }),
  ];
  const ids = coreCandidates(items, []);
  expect(ids).toEqual(["a", "c"]);
  expect(reviewProgress(items, ids)).toEqual({
    total: 2,
    confirmed: 1,
    pending: ["c"],
  });
  expect(items[1].normalizedValue).toBe(null);
});
it("기본 목록은 핵심 항목이며 전체 필터와 상세 편집을 유지한다", () => {
  const items = [item("a", "income", 100), item("b", "unknown", 1)];
  render(
    <ReviewView
      items={items}
      coreIds={["a"]}
      links={[]}
      onEdit={vi.fn()}
      onConfirm={vi.fn()}
      onAdd={vi.fn()}
      onLink={vi.fn()}
      onUnlink={vi.fn()}
    />,
  );
  expect(screen.getAllByLabelText("숫자")).toHaveLength(1);
  expect(screen.getByRole("status").textContent).toContain("1 / 1개");
  expect(screen.getByLabelText("숫자").closest("details")?.open).toBe(false);
  fireEvent.change(screen.getByLabelText("목록 필터"), {
    target: { value: "전체" },
  });
  expect(screen.getAllByLabelText("숫자")).toHaveLength(2);
});
it("판정 결과와 준비 중 항목을 분리해도 기존 엔진 결과와 원본 이동은 유지한다", () => {
  const items = [item("a", "deposit", 40), item("t", "totalAssets", 50)];
  const specs = [
    calculation("assets", "t", { parts: ["a"] }),
    newCalculation("net", "missing"),
  ];
  const before = JSON.stringify(validateAll(items, [], specs)),
    prepare = vi.fn(),
    inspect = vi.fn();
  render(
    <ResultsView
      items={items}
      links={[]}
      calculations={specs}
      onChange={vi.fn()}
      onInspect={inspect}
      onPrepare={prepare}
      recommendationPanel={<p>추천</p>}
    />,
  );
  expect((screen.getByLabelText("결과 필터") as HTMLSelectElement).value).toBe(
    "판정 결과",
  );
  expect(
    screen.queryByText("검증 불가", { selector: "span", exact: true }),
  ).toBeNull();
  fireEvent.click(screen.getByText(/검증 준비 중 1건/));
  fireEvent.click(screen.getByRole("button", { name: "필요한 항목 확인" }));
  expect(prepare).toHaveBeenCalledWith(
    expect.objectContaining({ code: "CALC_NET" }),
  );
  fireEvent.click(screen.getByRole("button", { name: /CALC_ASSETS/ }));
  fireEvent.click(screen.getByRole("button", { name: "관련 항목 확인·수정" }));
  expect(inspect).toHaveBeenCalledWith(["t", "a"]);
  expect(JSON.stringify(validateAll(items, [], specs))).toBe(before);
});
