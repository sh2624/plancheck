import { describe, it, expect } from "vitest";
import { extractWorkbook, extractWord } from "../src/normalization/extract";
import {
  normalize,
  editCandidate,
  canConfirm,
} from "../src/normalization/values";
import { suggestLinks, removeLinks } from "../src/normalization/links";
import type { Candidate } from "../src/normalization/types";
import type { Cell, WordDocument } from "../src/parsers/types";
const cell = (
  address: string,
  value: string,
  type = "n",
  extra: Partial<Cell> = {},
): Cell => ({ address, value, type, raw: value, review: false, ...extra });
const sheet = (cells: Cell[]) => ({
  fileName: "arbitrary.xlsx",
  sheets: [{ name: "임의 시트", cells, merges: [] }],
});
const para = (text: string): WordDocument => ({
  fileName: "arbitrary.docx",
  blocks: [{ kind: "paragraph", location: "본문 문단 1", text, numbers: [] }],
});
export const example = (patch: Partial<Candidate> = {}): Candidate => ({
  id: "x",
  source: "XLSX",
  fileName: "x",
  location: "임의 시트!D7",
  originalText: "월 소득 315만 원",
  originalNumber: "315",
  label: "월 소득",
  number: "315",
  unit: "만 원",
  normalizedValue: 3150000,
  field: "income",
  asOf: "2026-10",
  period: "월간",
  scenario: "기본안",
  certainty: "미확인",
  confirmed: false,
  excluded: false,
  method: "행·열 문맥",
  confidence: "문맥 일치",
  note: "",
  ...patch,
});
describe("정규화", () => {
  it("금액·금리·기간과 0을 구분하고 잘못된 입력을 null로 둔다", () => {
    expect(normalize("315", "만 원")).toBe(3150000);
    expect(normalize("3,150,000", "원")).toBe(3150000);
    expect(normalize("1.5", "억 원")).toBe(150000000);
    expect(normalize("6.5", "%")).toBe(6.5);
    expect(normalize("36", "개월")).toBe(36);
    expect(normalize("0", "원")).toBe(0);
    expect(normalize("-1.2", "만 원")).toBe(-12000);
    for (const s of [
      "",
      "미정",
      "1,2",
      "Infinity",
      "1e999",
      "9007199254740992",
    ])
      expect(normalize(s, "원")).toBeNull();
    expect(normalize("315", "미확인")).toBeNull();
  });
  it("편집 시 원문은 보존하고 사용자 확인은 해제한다", () => {
    const next = editCandidate(example({ confirmed: true }), {
      number: "316",
      unit: "만 원",
    });
    expect(next.normalizedValue).toBe(3160000);
    expect(next.confirmed).toBe(false);
    expect(next.originalNumber).toBe("315");
    expect(next.originalText).toBe(example().originalText);
    expect(canConfirm(editCandidate(next, { unit: "%" }))).toBe(false);
  });
});
describe("문맥 기반 후보", () => {
  it("임의 셀 위치에서 단위를 읽고 반복 값·연간 값·미확인 값을 유지한다", () => {
    const items = extractWorkbook(
      sheet([
        cell("B2", "단위: 만 원", "s"),
        cell("C6", "항목", "s"),
        cell("F6", "월", "s"),
        cell("G6", "연", "s"),
        cell("C7", "월 실수령 소득", "s"),
        cell("F7", "315"),
        cell("G7", "3780"),
        cell("C8", "월 실수령 소득", "s"),
        cell("F8", "315"),
        cell("C9", "총자산", "s"),
        cell("F9", ""),
        cell("C10", "신용대출 금리(연)", "s"),
        cell("F10", "0.075", "n", { numberFormat: "0.0%" }),
        cell("C11", "연령", "s"),
        cell("F11", "29"),
      ]),
    );
    expect(items.filter((c) => c.field === "income")).toHaveLength(3);
    expect(items.find((c) => c.period === "연간")?.normalizedValue).toBe(
      37800000,
    );
    expect(
      items.find((c) => c.field === "totalAssets")?.normalizedValue,
    ).toBeNull();
    expect(items.find((c) => c.field === "loanRate")?.normalizedValue).toBe(
      7.5,
    );
    expect(items.some((c) => c.number === "29")).toBe(false);
  });
  it("명시 단위가 없으면 돈을 0이나 원으로 가정하지 않는다", () => {
    expect(
      extractWorkbook(sheet([cell("B3", "총자산", "s"), cell("C3", "800")]))[0]
        .normalizedValue,
    ).toBeNull();
  });
  it("누락 수식 캐시는 금액으로 정규화하지 않는다", () => {
    const item = extractWorkbook(
      sheet([
        cell("A1", "단위: 원", "s"),
        cell("A4", "총자산", "s"),
        cell("B4", "", "n", { formula: "SUM(B2:B3)", review: true }),
      ]),
    )[0];
    expect(item.normalizedValue).toBeNull();
  });
  it("문단에서 관련 수치만 후보로 만들며 무관한 숫자와 비율을 배제한다", () => {
    expect(extractWord(para("연령 29세, 문서번호 315"))).toHaveLength(0);
    const items = extractWord(
      para("월 실수령 소득 315만 원. 신용대출 연 6.5%, 잔액 507.9만 원."),
    );
    expect(
      items.some((c) => c.field === "income" && c.normalizedValue === 3150000),
    ).toBe(true);
    expect(
      items.some((c) => c.field === "loanRate" && c.normalizedValue === 6.5),
    ).toBe(true);
    expect(
      items.some(
        (c) => c.field === "loanBalance" && c.normalizedValue === 5079000,
      ),
    ).toBe(true);
    expect(
      extractWord(para("예금이자 포기분을 빼도 약 29.5만 원을 아낀다.")),
    ).toHaveLength(0);
  });
  it("목표명·기한·재원은 미확인 텍스트 후보로 유지한다", () => {
    const items = extractWord(
      para("· 4 전세 이동: 2030년 3월까지 옮긴다. 재원은 기존 보증금이다."),
    );
    expect(items.some((c) => c.field === "goal")).toBe(true);
    expect(items.find((c) => c.field === "deadline")?.period).toBe(
      "2030년 3월까지",
    );
    expect(items.some((c) => c.field === "fundingSource")).toBe(true);
  });
});
describe("수동 승인 연결", () => {
  it("금액과 단위 표기가 달라도 반복 후보를 유지하고 다른 날짜·시나리오를 표시한다", () => {
    const a = example(),
      b = example({
        id: "d1",
        source: "DOCX",
        number: "3200000",
        unit: "원",
        normalizedValue: 3200000,
        asOf: "2027",
        period: "연간",
        scenario: "대체안",
      }),
      c = { ...b, id: "d2" };
    const links = suggestLinks([a, b, c], []);
    expect(links).toHaveLength(2);
    expect(links[0].reason).toContain("기준일 다름");
    expect(links[0].reason).toContain("시나리오 다름");
    expect(links[0].reason).toContain("적용 기간 다름");
    expect(
      suggestLinks([a, b], [{ id: "l", xlsxId: "x", docxId: "d1" }]),
    ).toHaveLength(0);
    expect(
      removeLinks([{ id: "l", xlsxId: "x", docxId: "d1" }], new Set(["x"])),
    ).toHaveLength(0);
  });
  it("서로 다른 대출·제외 항목·서로 다른 지출을 자동 제안하지 않는다", () => {
    expect(
      suggestLinks(
        [
          example({ field: "loanRate", label: "신용대출 금리", unit: "%" }),
          example({
            id: "d",
            source: "DOCX",
            field: "loanRate",
            label: "학자금대출 금리",
            unit: "%",
          }),
        ],
        [],
      ),
    ).toHaveLength(0);
    expect(
      suggestLinks(
        [example(), example({ id: "d", source: "DOCX", excluded: true })],
        [],
      ),
    ).toHaveLength(0);
    expect(
      suggestLinks(
        [
          example({ field: "fixedExpense", label: "고정지출 · 월세" }),
          example({
            id: "d",
            source: "DOCX",
            field: "fixedExpense",
            label: "고정지출 · 통신비",
          }),
        ],
        [],
      ),
    ).toHaveLength(0);
  });
});

it("Word 표의 복수 값과 빈 값을 분리하고 각각의 원본 좌표를 유지한다", () => {
  const p = (text: string, location: string) => ({
    kind: "paragraph" as const,
    text,
    location,
    numbers: [],
  });
  const r = (texts: string[]) =>
    texts.map((text, i) => ({
      column: i + 1,
      span: 1,
      text,
      paragraphs: [p(text, `${i + 1}열`)],
    }));
  const items = extractWord({
    fileName: "other.docx",
    blocks: [
      p("단위: 만 원", "문단 1"),
      {
        kind: "table",
        location: "표 8",
        rows: [
          r(["항목", "월"]),
          r(["월 실수령 / 월 생활비", "315 / 250"]),
          r(["총자산", "—"]),
        ],
      },
    ],
  });
  expect(items.filter((c) => c.field === "income")).toHaveLength(1);
  expect(items.some((c) => c.field === "unknown" && c.number === "250")).toBe(
    true,
  );
  expect(
    items.find((c) => c.field === "totalAssets")?.normalizedValue,
  ).toBeNull();
  expect(items.every((c) => c.location.includes("표 8"))).toBe(true);
});

it("상환액 설명에 상환방식이 언급되어도 월 상환액 후보를 누락하지 않는다", () => {
  const inputs = extractWorkbook(
    sheet([
      cell("A1", "단위: 만 원", "s"),
      cell("A2", "신용대출 상환액 (입력된 상환방식에 따름)", "s"),
      cell("B2", "15.5"),
    ]),
  );
  expect(inputs[0].field).toBe("loanPayment");
  expect(inputs[0].normalizedValue).toBe(155000);
});

it("월세 보증금은 월간 현금흐름으로 추정하지 않는다", () => {
  const items = extractWorkbook(
    sheet([
      cell("A1", "단위: 만 원", "s"),
      cell("A2", "월세 보증금", "s"),
      cell("B2", "1000"),
    ]),
  );
  expect(items[0].field).toBe("housingDeposit");
  expect(items[0].period).toBe("");
});
