import type { Finding } from "../inspection/analyze";
import type { ReviewDecision } from "../inspection/review";
export type ReviewedFinding = Finding & { decision?: ReviewDecision };
export const resultSections = [
  "확정 오류",
  "수치 불일치 및 확인 필요",
  "검증 통과",
  "검증 대상이지만 정보 부족으로 보류",
] as const;
export type ResultSection = (typeof resultSections)[number];
/** 승인 판정과 명시적 보류를 구분한다. 자동 수치 일치는 통과로 승격하지 않는다. */
export function findingSection(f: ReviewedFinding): ResultSection {
  if (f.decision?.choice === "different" || f.decision?.choice === "unknown")
    return resultSections[3];
  if (f.approved?.status === "오류") return resultSections[0];
  if (f.approved?.status === "검증 통과") return resultSections[2];
  return (f.approved ?? f.result).status === "검증 불가"
    ? resultSections[3]
    : resultSections[1];
}
/** 같은 원본을 재사용하는 연결들을 묶되 각 결과·근거·원본 ID를 모두 유지한다. */
export function groupFindings(findings: ReviewedFinding[]) {
  return resultSections.map((section) => {
    const list = findings.filter((f) => findingSection(f) === section),
      parents = list.map((_, i) => i),
      seen = new Map<string, number>();
    const root = (i: number): number =>
      parents[i] === i ? i : root(parents[i]);
    list.forEach((f, i) => {
      const tokens =
        f.kind === "CROSS"
          ? f.result.evidence.map((c) => `${f.result.code}:${c.id}`)
          : f.result.references?.length
            ? f.result.references.map(
                (r) =>
                  `${f.result.code}:${JSON.stringify([r.source, r.fileName, r.location])}`,
              )
            : [`${f.kind}:${f.id}`];
      for (const token of tokens) {
        const prev = seen.get(token);
        if (prev !== undefined) parents[root(i)] = root(prev);
        else seen.set(token, i);
      }
    });
    const groups = new Map<number, ReviewedFinding[]>();
    list.forEach((f, i) =>
      groups.set(root(i), [...(groups.get(root(i)) ?? []), f]),
    );
    return {
      section,
      count: list.length,
      groups: [...groups.values()].map((items) =>
        items.sort(
          (a, b) =>
            Number(!!b.approved) - Number(!!a.approved) ||
            Number(b.primary) - Number(a.primary),
        ),
      ),
    };
  });
}
