import type { Candidate, Link } from "../normalization/types";
import { canConfirm } from "../normalization/values";
export const checkpointKey = "plancheck.review.v1";
export type Documents = Partial<Record<Candidate["source"], string>>;
export type Checkpoint = {
  version: 1;
  nonce: string;
  savedAt: number;
  documents: Documents;
  entries: { key: string; confirmed: boolean; excluded: boolean }[];
  links: { x: string; d: string }[];
};
const hex = (data: ArrayBuffer) =>
  Array.from(new Uint8Array(data), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
/** 문서와 검토 상태는 단방향 SHA-256 지문으로만 저장한다. 원문·금액·파일명은 저장하지 않는다. */
export async function digest(data: ArrayBuffer | string): Promise<string> {
  return hex(
    await crypto.subtle.digest(
      "SHA-256",
      typeof data === "string" ? new TextEncoder().encode(data) : data,
    ),
  );
}
async function keyOf(c: Candidate, nonce: string): Promise<string> {
  const { confirmed: _, excluded: __, ...value } = c;
  void _;
  void __;
  return digest(`${nonce}:${JSON.stringify(value)}`);
}
/** 명시적으로 요청된 현재 확인·제외 상태와 승인 연결만 해시 체크포인트로 만든다. */
export async function createCheckpoint(
  items: Candidate[],
  links: Link[],
  documents: Documents,
): Promise<Checkpoint> {
  if (
    !Object.keys(documents).length ||
    items
      .filter((c) => c.method !== "직접 입력")
      .some((c) => !documents[c.source]) ||
    Object.values(documents).some(
      (value) => !value || !/^[a-f0-9]{64}$/.test(value),
    )
  )
    throw Error("문서 지문을 확인할 수 없습니다. 파일을 다시 선택하세요.");
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const keyed = await Promise.all(
    items
      .filter((c) => c.method !== "직접 입력")
      .map(async (c) => ({ c, key: await keyOf(c, nonce) })),
  );
  const keys = new Map(keyed.map((x) => [x.c.id, x.key]));
  return {
    version: 1,
    nonce,
    savedAt: Date.now(),
    documents: { ...documents },
    entries: keyed
      .filter((x) => x.c.confirmed || x.c.excluded)
      .map((x) => ({
        key: x.key,
        confirmed: x.c.confirmed && !x.c.excluded,
        excluded: x.c.excluded,
      })),
    links: links.flatMap((l) => {
      const a = items.find((c) => c.id === l.xlsxId),
        b = items.find((c) => c.id === l.docxId);
      return a?.confirmed &&
        b?.confirmed &&
        !a.excluded &&
        !b.excluded &&
        keys.has(a.id) &&
        keys.has(b.id)
        ? [{ x: keys.get(l.xlsxId)!, d: keys.get(l.docxId)! }]
        : [];
    }),
  };
}
/** 로드된 문서의 전체 파일 지문이 모두 일치해야 이전 확인 상태를 적용할 수 있다. */
export function documentsMatch(a: Documents, b: Documents): boolean {
  const keys = Object.keys(a) as Candidate["source"][];
  return (
    keys.length > 0 &&
    keys.length === Object.keys(b).length &&
    keys.every((k) => !!a[k] && a[k] === b[k])
  );
}
/** JSON은 제한된 해시·불리언 구조로 검증하고 금융 데이터 필드를 받아들이지 않는다. */
export function parseCheckpoint(text: string | null): Checkpoint | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Checkpoint;
    const hash = (s: unknown) =>
      typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
    if (
      v.version !== 1 ||
      typeof v.nonce !== "string" ||
      !/^[a-f0-9]{32}$/.test(v.nonce) ||
      !Number.isFinite(v.savedAt) ||
      !v.documents ||
      !Array.isArray(v.entries) ||
      !Array.isArray(v.links) ||
      v.entries.length > 100000 ||
      v.links.length > 100000
    )
      return null;
    const docs = Object.entries(v.documents);
    if (
      !docs.length ||
      docs.some(([k, val]) => !["XLSX", "DOCX"].includes(k) || !hash(val))
    )
      return null;
    if (
      v.entries.some(
        (e) =>
          !hash(e.key) ||
          typeof e.confirmed !== "boolean" ||
          typeof e.excluded !== "boolean",
      ) ||
      v.links.some((l) => !hash(l.x) || !hash(l.d))
    )
      return null;
    return {
      version: 1,
      nonce: v.nonce,
      savedAt: v.savedAt,
      documents: Object.fromEntries(docs),
      entries: v.entries.map((e) => ({
        key: e.key,
        confirmed: e.confirmed,
        excluded: e.excluded,
      })),
      links: v.links.map((l) => ({ x: l.x, d: l.d })),
    };
  } catch {
    return null;
  }
}
/** 재업로드 후 사용자가 복원을 요청한 경우에만 동일한 원문·편집값의 상태를 복구한다. */
export async function restoreCheckpoint(
  snapshot: Checkpoint,
  items: Candidate[],
  links: Link[],
  documents: Documents,
) {
  if (!documentsMatch(snapshot.documents, documents))
    throw Error("저장 당시와 같은 파일을 모두 다시 선택해야 합니다.");
  const keyed = await Promise.all(
    items.map(async (c) => ({ c, key: await keyOf(c, snapshot.nonce) })),
  );
  const entries = new Map(snapshot.entries.map((e) => [e.key, e]));
  let restored = 0;
  const next = keyed.map(({ c, key }) => {
    const saved = entries.get(key);
    if (!saved) return c;
    restored++;
    return {
      ...c,
      excluded: saved.excluded,
      confirmed:
        !saved.excluded &&
        saved.confirmed &&
        canConfirm({ ...c, excluded: saved.excluded }),
    };
  });
  const ids = new Map(keyed.map(({ c, key }) => [key, c.id]));
  const approved = links.filter((l) => {
    const x = next.find((c) => c.id === l.xlsxId),
      d = next.find((c) => c.id === l.docxId);
    return x?.confirmed && d?.confirmed && !x.excluded && !d.excluded;
  });
  for (const l of snapshot.links) {
    const a = next.find((c) => c.id === ids.get(l.x)),
      b = next.find((c) => c.id === ids.get(l.d));
    if (
      a?.source === "XLSX" &&
      b?.source === "DOCX" &&
      a.confirmed &&
      b.confirmed &&
      !a.excluded &&
      !b.excluded &&
      !approved.some((p) => p.xlsxId === a.id && p.docxId === b.id)
    )
      approved.push({ id: crypto.randomUUID(), xlsxId: a.id, docxId: b.id });
  }
  return { items: next, links: approved, restored };
}
