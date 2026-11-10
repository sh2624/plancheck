import { openAdvancedResults } from "./workflow-ui";
import { readFileSync } from "node:fs";
import { afterEach, it, expect } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import App from "../src/App";
afterEach(cleanup);
it.skipIf(!process.env.PLANCHECK_XLSX || !process.env.PLANCHECK_DOCX)(
  "실제 파일 업로드→핵심 추천 검토→선택 승인→금리 차이→원본 확인까지 시연한다",
  async () => {
    render(<App />);
    const file = (path: string, name: string) => {
      const b = readFileSync(path);
      return Object.assign(new File([b], name), {
        arrayBuffer: async () =>
          b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      });
    };
    fireEvent.change(screen.getByLabelText(/검토할 Excel/), {
      target: { files: [file(process.env.PLANCHECK_XLSX!, "financial.xlsx")] },
    });
    fireEvent.change(screen.getByLabelText(/검토할 Word/), {
      target: { files: [file(process.env.PLANCHECK_DOCX!, "report.docx")] },
    });
    await screen.findByText("원본: financial.xlsx", {}, { timeout: 5000 });
    await screen.findByText(/원본: report.docx/, {}, { timeout: 5000 });
    openAdvancedResults();
    expect(
      screen.queryByText("오류", { selector: "span", exact: true }),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText("추천 종류"), {
      target: { value: "CROSS" },
    });
    const credit = screen.getByRole("button", {
      name: /^CROSS ·.*신용대출.*금리/,
    });
    fireEvent.click(credit);
    const review = screen.getByRole("region", { name: "추천 근거 검토" });
    expect(
      within(review)
        .getAllByLabelText("추천 숫자")
        .map((n) => (n as HTMLInputElement).value),
    ).toEqual(["7.5", "6.5"]);
    // 원문 수치를 바꾸지 않고 사용자가 두 문서의 동일 기준·확정 상태를 검토한 절차를 재현한다.
    for (const input of within(review).getAllByLabelText("추천 숫자")) {
      const row = input.closest("tr")!;
      fireEvent.change(within(row).getByLabelText("추천 기준일"), {
        target: { value: "2026-10-31" },
      });
      fireEvent.change(within(row).getByLabelText("추천 시나리오"), {
        target: { value: "사용자가 동일 기준으로 확인한 안" },
      });
      fireEvent.change(within(row).getByLabelText("추천 확정 여부"), {
        target: { value: "확정" },
      });
    }
    expect(
      screen.queryByText("오류", { selector: "span", exact: true }),
    ).toBeNull();
    fireEvent.click(within(review).getByRole("checkbox"));
    fireEvent.click(
      within(review).getByRole("button", { name: "선택 값 확인·검증 승인" }),
    );
    expect(
      screen.getByText("오류", { selector: "span", exact: true }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /CROSS_VALUE/ }));
    const detail = screen.getByRole("region", { name: "검증 근거 상세" });
    expect(detail.textContent).toContain("1 %p");
    expect(detail.textContent).toContain("financial.xlsx");
    expect(detail.textContent).toContain("report.docx");
    expect(within(detail).getAllByText(/원본 숫자/)).toHaveLength(2);
    fireEvent.click(
      within(detail).getByRole("button", { name: "관련 항목 확인·수정" }),
    );
    const data = screen.getByRole("region", { name: "데이터 확인" });
    expect(within(data).getAllByLabelText("숫자")).toHaveLength(2);
    expect(data.textContent).toContain("확인 완료 2개");
  },
  15000,
);
