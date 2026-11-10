import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      });
    };
    fireEvent.change(screen.getByLabelText(/검토할 Excel/), {
      target: { files: [fixture(process.env.PLANCHECK_XLSX!, "sample.xlsx")] },
    });
    fireEvent.change(screen.getByLabelText(/검토할 Word/), {
      target: { files: [fixture(process.env.PLANCHECK_DOCX!, "sample.docx")] },
    });
    await screen.findByText("원본: sample.xlsx");
    await screen.findByText(/원본: sample.docx/);
    expect(screen.getAllByRole("option")).toHaveLength(5);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(10);
    expect(screen.queryByRole("alert")).toBeNull();
  },
);
