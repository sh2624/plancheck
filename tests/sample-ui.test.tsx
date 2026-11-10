import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import App from "../src/App";
afterEach(cleanup);
it.skipIf(!process.env.PLANCHECK_XLSX || !process.env.PLANCHECK_DOCX)(
  "실제 샘플을 업로드하여 양쪽 화면에 원본 결과를 표시한다",
  async () => {
    render(<App />);
    const fixture = (path: string, name: string) => {
      const bytes = readFileSync(path);
      return Object.assign(new File([bytes], name), {
        arrayBuffer: async () =>
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
      });
    };
    fireEvent.change(screen.getByLabelText(/검토할 Excel/), {
      target: { files: [fixture(process.env.PLANCHECK_XLSX!, "sample.xlsx")] },
    });
    fireEvent.change(screen.getByLabelText(/검토할 Word/), {
      target: { files: [fixture(process.env.PLANCHECK_DOCX!, "sample.docx")] },
    });
    // 실제 ZIP/XML 처리 시간은 병렬 테스트의 CPU 부하에 따라 달라진다.
    await screen.findByText("원본: sample.xlsx", {}, { timeout: 5000 });
    await screen.findByText(/원본: sample.docx/, {}, { timeout: 5000 });
    fireEvent.click(screen.getByText("원본 상세 보기 · Excel 재무표"));
    fireEvent.click(screen.getByText("원본 상세 보기 · Word 보고서"));
    expect(screen.getAllByRole("option")).toHaveLength(5);
    const original = screen
      .getByRole("region", { name: "Word 보고서" })
      .querySelector(".original-details")! as HTMLElement;
    expect(within(original).getAllByRole("heading", { level: 3 })).toHaveLength(
      10,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  },
  // 실제 두 문서의 전체 원본 테이블을 펼치는 DOM 검사는 병렬 실행 부하를 고려한다.
  15000,
);
