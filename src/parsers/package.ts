import JSZip from "jszip";
export const MAX_BYTES = 30 * 1024 * 1024;
/** 허용 확장자와 브라우저 처리 용량을 검사한다. */
export function validateFile(file: { name: string; size: number }, extension: string) {
  if (!file.name.toLowerCase().endsWith(`.${extension}`)) throw new Error(`.${extension} 파일만 지원합니다.`);
  if (!file.size) throw new Error("빈 파일입니다.");
  if (file.size > MAX_BYTES) throw new Error("파일은 30MB 이하로 선택해 주세요.");
}
/** 압축 문서를 열고 과도한 압축 해제를 제한한다. */
export async function openPackage(data: ArrayBuffer) {
  const zip = await JSZip.loadAsync(data);
  let total = 0;
  return async (path: string) => {
    const entry = zip.file(path);
    if (!entry) throw new Error(`문서 구성 요소가 없습니다: ${path}`);
    const bytes = await entry.async("uint8array");
    total += bytes.length;
    if (total > 100 * 1024 * 1024) throw new Error("문서 압축 해제 용량이 너무 큽니다.");
    const xml = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
    if (xml.getElementsByTagName("parsererror").length) throw new Error("문서 XML을 읽을 수 없습니다.");
    return xml;
  };
}
export const children = (node: Node, name: string) =>
  Array.from(node.childNodes).filter((n): n is Element => n.nodeType === 1 && (n as Element).localName === name);
export const descendants = (node: Element | Document, name: string) =>
  Array.from(node.getElementsByTagNameNS("*", name));
export const attr = (node: Element | undefined, name: string) =>
  node ? Array.from(node.attributes).find((a) => a.localName === name)?.value : undefined;
export const content = (node: Element | undefined) => node?.textContent ?? "";
/** 관계 대상 경로를 패키지 내부 경로로 정규화한다. */
export function resolvePart(base: string, target: string) {
  const parts = (target.startsWith("/") ? target.slice(1) : `${base}/${target}`).split("/");
  const result: string[] = [];
  for (const part of parts) {
    if (part === "..") result.pop();
    else if (part && part !== ".") result.push(part);
  }
  return result.join("/");
}
