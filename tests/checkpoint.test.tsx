import { webcrypto } from "node:crypto";
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createCheckpoint,
  restoreCheckpoint,
  parseCheckpoint,
  digest,
  checkpointKey,
} from "../src/session/checkpoint";
import { SessionReview } from "../src/components/SessionReview";
import { item } from "./validation-fixtures";
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const items = [
  item("a", "income", 3150000, {
    label: "개인 급여 원문",
    fileName: "개인문서.xlsx",
    originalText: "개인적인 금융 원문 3,150,000원",
  }),
  item("b", "income", 3150000, { source: "DOCX", fileName: "개인보고서.docx" }),
];
const links = [{ id: "l", xlsxId: "a", docxId: "b" }];
async function docs() {
  return {
    XLSX: await digest("spreadsheet bytes"),
    DOCX: await digest("word bytes"),
  };
}
it("해시·불리언만 저장하고 원문·파일명·금액·원본 ID를 저장하지 않는다", async () => {
  const snapshot = await createCheckpoint(items, links, await docs()),
    json = JSON.stringify(snapshot);
  for (const text of [
    "개인 급여",
    "개인문서.xlsx",
    "개인보고서.docx",
    "금융 원문",
    "3,150,000",
    '"number"',
    '"originalText"',
    '"xlsxId"',
  ])
    expect(json).not.toContain(text);
  expect(snapshot.entries).toHaveLength(2);
  expect(snapshot.links).toHaveLength(1);
  expect(snapshot.entries.every((e) => /^[a-f0-9]{64}$/.test(e.key))).toBe(
    true,
  );
  const next = await restoreCheckpoint(
    snapshot,
    items.map((c) => ({ ...c, confirmed: false })),
    [],
    await docs(),
  );
  expect(next.items.every((c) => c.confirmed)).toBe(true);
  expect(next.links).toHaveLength(1);
});
it("파일의 일부라도 바뀌거나 일부 파일만 올리면 복원하지 않는다", async () => {
  const manifest = await docs(),
    snapshot = await createCheckpoint(items, links, manifest);
  await expect(
    restoreCheckpoint(snapshot, items, [], {
      ...manifest,
      XLSX: await digest("changed bytes"),
    }),
  ).rejects.toThrow("같은 파일");
  await expect(
    restoreCheckpoint(snapshot, items, [], { XLSX: manifest.XLSX }),
  ).rejects.toThrow("같은 파일");
});
it("수정한 숫자는 저장하지 않으며 서로 다른 값에 이전 승인을 적용하지 않는다", async () => {
  const edited = [{ ...items[0], number: "3160000", normalizedValue: 3160000 }],
    manifest = { XLSX: await digest("same") };
  const snapshot = await createCheckpoint(edited, [], manifest);
  const next = await restoreCheckpoint(
    snapshot,
    [{ ...items[0], confirmed: false }],
    [],
    manifest,
  );
  expect(next.restored).toBe(0);
  expect(next.items[0].confirmed).toBe(false);
  expect(next.items[0].number).toBe("3150000");
});
it("잘못된 저장 형식은 거부하고 알려지지 않은 금융 필드는 버린다", async () => {
  expect(parseCheckpoint("bad json")).toBeNull();
  const s = await createCheckpoint(items, links, await docs());
  expect(
    parseCheckpoint(
      JSON.stringify({
        ...s,
        entries: [{ key: "bad", confirmed: true, excluded: false }],
      }),
    ),
  ).toBeNull();
  expect(
    JSON.stringify(
      parseCheckpoint(JSON.stringify({ ...s, rawText: "SECRET ORIGINAL" })),
    ),
  ).not.toContain("SECRET ORIGINAL");
});
it("동의와 저장 버튼 전에는 저장하지 않고, 재마운트해도 자동 복원하지 않는다", async () => {
  const manifest = await docs(),
    onRestore = vi.fn();
  const set = vi.spyOn(Storage.prototype, "setItem");
  const first = render(
    <SessionReview
      items={items}
      links={links}
      documents={manifest}
      onRestore={onRestore}
    />,
  );
  fireEvent.click(screen.getByText("새로고침 전 확인 상태 임시 저장"));
  expect(set).not.toHaveBeenCalled();
  expect(
    (
      screen.getByRole("button", {
        name: "확인 상태 임시 저장",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "확인 상태 임시 저장" }));
  await waitFor(() =>
    expect(sessionStorage.getItem(checkpointKey)).not.toBeNull(),
  );
  expect(localStorage.length).toBe(0);
  first.unmount();
  render(
    <SessionReview
      items={items.map((c) => ({ ...c, confirmed: false }))}
      links={[]}
      documents={manifest}
      onRestore={onRestore}
    />,
  );
  expect(onRestore).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("새로고침 전 확인 상태 임시 저장"));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: "동일 파일의 확인 상태 복원" }),
  );
  await waitFor(() => expect(onRestore).toHaveBeenCalled());
  expect(
    onRestore.mock.calls[0][0].items.every(
      (c: (typeof items)[number]) => c.confirmed,
    ),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "임시 저장 삭제" }));
  expect(sessionStorage.getItem(checkpointKey)).toBeNull();
});

it("저장·복원 중 검토 내용이 바뀌면 과거 승인을 적용하지 않는다", async () => {
  const manifest = await docs(),
    snapshot = await createCheckpoint(items, links, manifest);
  sessionStorage.setItem(checkpointKey, JSON.stringify(snapshot));
  let revision = 0;
  const restored = vi.fn();
  let resolve!: (value: ArrayBuffer) => void;
  vi.spyOn(webcrypto.subtle, "digest").mockImplementationOnce(
    () =>
      new Promise<ArrayBuffer>((r) => {
        resolve = r;
      }),
  );
  render(
    <SessionReview
      items={items.map((c) => ({ ...c, confirmed: false }))}
      links={[]}
      documents={manifest}
      getRevision={() => revision}
      onRestore={restored}
    />,
  );
  fireEvent.click(screen.getByText("새로고침 전 확인 상태 임시 저장"));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: "동일 파일의 확인 상태 복원" }),
  );
  revision++;
  resolve(new ArrayBuffer(32));
  await screen.findByText(/검토 내용이 변경되어/);
  expect(restored).not.toHaveBeenCalled();
});
it("직접 추가한 행은 저장·복원 대상에서 제외하고 제외 상태는 보존한다", async () => {
  const original = { ...items[0], confirmed: false, excluded: true },
    manual = { ...items[1], method: "직접 입력" as const };
  const manifest = { XLSX: await digest("file") };
  const snapshot = await createCheckpoint([original, manual], [], manifest);
  expect(snapshot.entries).toHaveLength(1);
  const next = await restoreCheckpoint(
    snapshot,
    [{ ...original, excluded: false }],
    [],
    manifest,
  );
  expect(next.items[0].excluded).toBe(true);
  expect(next.items[0].confirmed).toBe(false);
});

it("제외 상태를 복원하면 이전에 승인한 연결도 해제한다", async () => {
  const manifest = await docs(),
    snapshot = await createCheckpoint(
      [{ ...items[0], excluded: true, confirmed: false }, items[1]],
      [],
      manifest,
    );
  const restored = await restoreCheckpoint(snapshot, items, links, manifest);
  expect(restored.items[0].excluded).toBe(true);
  expect(restored.links).toHaveLength(0);
});

it("동일 파일명이라도 전체 바이트가 다르면 업로드 지문이 바뀐다", async () => {
  const { DocumentPanel } = await import("../src/components/DocumentPanel");
  const onData = vi.fn();
  render(
    <DocumentPanel
      extension="xlsx"
      title="지문 확인"
      parse={async () => "추출 결과"}
      onData={onData}
    >
      {(text) => <p>{text}</p>}
    </DocumentPanel>,
  );
  const file = (last: number) =>
    Object.assign(new File([new Uint8Array([1, 2, last])], "same.xlsx"), {
      arrayBuffer: async () => new Uint8Array([1, 2, last]).buffer,
    });
  fireEvent.change(screen.getByLabelText(/파일 선택/), {
    target: { files: [file(3)] },
  });
  await screen.findByText("추출 결과");
  const first = onData.mock.calls.find((args) => args[0] === "추출 결과")[1];
  expect(first).toBe(await digest(new Uint8Array([1, 2, 3]).buffer));
  onData.mockClear();
  fireEvent.change(screen.getByLabelText(/파일 선택/), {
    target: { files: [file(4)] },
  });
  await screen.findByText("추출 결과");
  const second = onData.mock.calls.find((args) => args[0] === "추출 결과")[1];
  expect(second).not.toBe(first);
});
