import { attr, children, content, descendants, openPackage, resolvePart } from "./package";
import type { Workbook, Cell } from "./types";
/** 시트별 실제 셀, 수식과 저장된 계산값을 추출하며 재계산하지 않는다. */
export async function parseXlsx(data: ArrayBuffer, fileName: string): Promise<Workbook> {
  const read = await openPackage(data);
  const book = await read("xl/workbook.xml");
  const rels = descendants(await read("xl/_rels/workbook.xml.rels"), "Relationship");
  const stringsRel = rels.find((r) => attr(r, "Type")?.endsWith("/sharedStrings"));
  const strings = stringsRel
    ? descendants(await read(resolvePart("xl", attr(stringsRel, "Target")!)), "si").map((si) =>
        descendants(si, "t").map(content).join(""),
      )
    : [];
  const sheets: Workbook["sheets"] = [];
  let count = 0;
  for (const sheet of descendants(book, "sheet")) {
    const relation = rels.find((r) => attr(r, "Id") === attr(sheet, "id"));
    if (!relation || attr(relation, "TargetMode") === "External") throw new Error("시트 연결 정보를 읽을 수 없습니다.");
    const xml = await read(resolvePart("xl", attr(relation, "Target")!));
    const cells: Cell[] = descendants(xml, "c").map((c) => {
      if (++count > 100000) throw new Error("100,000개 이하의 셀을 지원합니다.");
      const v = children(c, "v")[0],
        f = children(c, "f")[0];
      const type = attr(c, "t") ?? "n",
        raw = content(v);
      const sharedValue = /^\d+$/.test(raw) ? strings[Number(raw)] : undefined;
      const missingSharedValue = type === "s" && sharedValue === undefined;
      const value =
        type === "s" ? (sharedValue ?? raw) : type === "inlineStr" ? descendants(c, "t").map(content).join("") : raw;
      return {
        address: attr(c, "r") ?? "?",
        raw,
        value,
        type,
        formula: f ? content(f) || `[공유 수식 ${attr(f, "si") ?? ""}: 원본 참조 필요]` : undefined,
        result: f && v && raw !== "" ? value : undefined,
        review: missingSharedValue || (!!f && (!v || raw === "" || type === "e")) || type === "e",
      };
    });
    sheets.push({
      name: attr(sheet, "name") ?? "",
      cells,
      merges: descendants(xml, "mergeCell").map((c) => attr(c, "ref") ?? ""),
    });
  }
  if (!sheets.length) throw new Error("워크시트가 없는 문서입니다.");
  return { fileName, sheets };
}
