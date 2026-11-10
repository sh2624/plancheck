import { afterEach, it, expect, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import App from "../src/App";
vi.mock("../src/parsers/xlsx", () => ({
  parseXlsx: vi.fn(async () => ({
    fileName: "test.xlsx",
    sheets: [
      {
        name: "시트",
        merges: [],
        cells: [
          {
            address: "A1",
            value: "단위: 만 원",
            raw: "",
            type: "s",
            review: false,
          },
          {
            address: "A4",
            value: "월 소득",
            raw: "",
            type: "s",
            review: false,
          },
          { address: "B4", value: "315", raw: "315", type: "n", review: false },
        ],
      },
    ],
  })),
}));
vi.mock("../src/parsers/docx", () => ({
  parseDocx: vi.fn(async () => ({
    fileName: "test.docx",
    blocks: [
      {
        kind: "paragraph",
        location: "본문 문단 1",
        text: "월 소득 320만 원",
        numbers: ["320만 원"],
      },
    ],
  })),
}));
afterEach(cleanup);
async function upload() {
  render(<App />);
  const f = (name: string) =>
    Object.assign(new File(["x"], name), {
      arrayBuffer: async () => new ArrayBuffer(1),
    });
  fireEvent.change(screen.getByLabelText(/검토할 Excel/), {
    target: { files: [f("test.xlsx")] },
  });
  fireEvent.change(screen.getByLabelText(/검토할 Word/), {
    target: { files: [f("test.docx")] },
  });
  await screen.findByText("원본: test.xlsx");
  await screen.findByText(/원본: test.docx/);
  fireEvent.click(screen.getByRole("button", { name: /2. 데이터 확인/ }));
  return screen.getByRole("region", { name: "데이터 확인" });
}
function approve(region: HTMLElement) {
  const x = within(region).getByLabelText("Excel 항목"),
    d = within(region).getByLabelText("Word 항목");
  fireEvent.change(x, {
    target: {
      value: within(x).getAllByRole("option")[1].getAttribute("value"),
    },
  });
  fireEvent.change(d, {
    target: {
      value: within(d).getAllByRole("option")[1].getAttribute("value"),
    },
  });
  fireEvent.click(
    within(region).getByRole("button", { name: "선택 항목 연결 승인" }),
  );
}
it("실제 정규화 경로로 숫자·단위·시점·확정 여부를 수정하고 승인 연결을 해제한다", async () => {
  const region = await upload();
  const number = within(region).getAllByLabelText("숫자")[0];
  const row = number.closest("tr")!;
  fireEvent.change(number, { target: { value: "316" } });
  fireEvent.change(within(row).getByLabelText("단위"), {
    target: { value: "만 원" },
  });
  expect(within(row).getByText("정규화: 3,160,000 원")).toBeTruthy();
  fireEvent.change(within(row).getByLabelText("기준일"), {
    target: { value: "2026-11" },
  });
  fireEvent.change(within(row).getByLabelText("확정 여부"), {
    target: { value: "가정" },
  });
  fireEvent.click(within(row).getByRole("button", { name: "확인 완료" }));
  expect(within(row).getByText("사용자 확인 완료")).toBeTruthy();
  approve(region);
  expect(
    within(region).getByRole("heading", { name: "승인한 연결 1개" }),
  ).toBeTruthy();
  fireEvent.change(number, { target: { value: "" } });
  expect(within(row).getByText("확인 필요")).toBeTruthy();
  expect(within(row).getByText("정규화: 확인 필요")).toBeTruthy();
  expect(
    within(region).getByRole("heading", { name: "승인한 연결 0개" }),
  ).toBeTruthy();
  expect(
    (
      within(row).getByRole("button", {
        name: "확인 완료",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
it("제외·복원·직접 추가를 지원하고 파일 초기화 시 관련 연결을 지운다", async () => {
  const region = await upload();
  approve(region);
  const row = within(region).getAllByLabelText("숫자")[0].closest("tr")!;
  fireEvent.click(within(row).getByRole("button", { name: "제외" }));
  expect(within(region).getAllByLabelText("숫자")).toHaveLength(1);
  fireEvent.change(within(region).getByLabelText("목록 필터"), {
    target: { value: "제외됨" },
  });
  fireEvent.click(within(region).getByRole("button", { name: "복원" }));
  fireEvent.change(within(region).getByLabelText("목록 필터"), {
    target: { value: "전체" },
  });
  expect(within(region).getAllByLabelText("숫자")).toHaveLength(2);
  approve(region);
  fireEvent.click(screen.getByRole("button", { name: "1. 문서 등록" }));
  fireEvent.click(screen.getByRole("button", { name: "Excel 재무표 초기화" }));
  fireEvent.click(screen.getByRole("button", { name: /2. 데이터 확인/ }));
  expect(screen.getByRole("heading", { name: "승인한 연결 0개" })).toBeTruthy();
  expect(screen.getAllByLabelText("숫자")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "항목 직접 추가" }));
  const manual = screen.getByLabelText("원본 종류");
  fireEvent.change(manual, { target: { value: "DOCX" } });
  const added = manual.closest("tr")!;
  fireEvent.change(within(added).getByLabelText("항목명"), {
    target: { value: "직접 확인한 자산" },
  });
  fireEvent.change(within(added).getByLabelText("항목 유형"), {
    target: { value: "totalAssets" },
  });
  fireEvent.change(within(added).getByLabelText("숫자"), {
    target: { value: "10" },
  });
  fireEvent.change(within(added).getByLabelText("단위"), {
    target: { value: "만 원" },
  });
  fireEvent.click(within(added).getByRole("button", { name: "확인 완료" }));
  expect(within(added).getByText("사용자 확인 완료")).toBeTruthy();
});

it("확인한 승인 연결만 결과에 표시하고 편집 후 오래된 판정을 지운다", async () => {
  const region = await upload();
  for (const input of within(region).getAllByLabelText("숫자")) {
    const row = input.closest("tr")!;
    fireEvent.change(within(row).getByLabelText("기준일"), {
      target: { value: "2026-10-31" },
    });
    fireEvent.change(within(row).getByLabelText("시나리오"), {
      target: { value: "기본안" },
    });
    fireEvent.change(within(row).getByLabelText("적용 기간 / 기한"), {
      target: { value: "월간" },
    });
    fireEvent.change(within(row).getByLabelText("확정 여부"), {
      target: { value: "확정" },
    });
    fireEvent.click(within(row).getByRole("button", { name: "확인 완료" }));
  }
  approve(region);
  fireEvent.click(screen.getByRole("button", { name: "3. 검수 결과" }));
  expect(
    screen.getByText("오류", { exact: true, selector: "span" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /CROSS_VALUE/ }));
  fireEvent.click(screen.getByRole("button", { name: "관련 항목 확인·수정" }));
  expect((screen.getByLabelText("목록 필터") as HTMLSelectElement).value).toBe(
    "관련 항목",
  );
  expect(screen.getAllByLabelText("숫자")).toHaveLength(2);
  fireEvent.change(screen.getAllByLabelText("숫자")[0], {
    target: { value: "320" },
  });
  fireEvent.click(screen.getByRole("button", { name: "3. 검수 결과" }));
  expect(screen.queryByRole("button", { name: /CROSS_VALUE/ })).toBeNull();
  expect(
    screen.queryByText("오류", { exact: true, selector: "span" }),
  ).toBeNull();
});
