import type { Candidate, Link } from "../normalization/types";
import type { Calculation, EvidenceRef, Result } from "../validation/types";
import type { Planning } from "../planning/types";
import {
  discoverCalculation,
  discoverCross,
  validateAll,
} from "../validation/engine";
import { discoverPlanning, validatePlanning } from "../planning/engine";
import { recommend } from "../recommendations/recommend";
import type { Recommendation } from "../recommendations/types";
import { loanIdentity } from "../recommendations/recommend";
import { fieldLabels } from "../normalization/types";
import { presentResult } from "../presentation/results";
import { formatFinancial } from "../presentation/format";
export type Finding = {
  id: string;
  kind: Recommendation["kind"];
  title: string;
  signal: "수치 차이" | "조건 확인" | "수치 일치";
  result: Result;
  recommendation?: Recommendation;
  primary: boolean;
  approved?: Result;
  questions: string[];
};
export type InspectionInput = {
  items: Candidate[];
  links: Link[];
  calculations: Calculation[];
  planning: Planning;
  references: EvidenceRef[];
};
/** 원본과 승인 상태를 변경하지 않고 추천 관계를 분석해 참고 후보와 확정 검증을 구분한다. */
export function inspectDocuments(input: InspectionInput): Finding[] {
  const { items, links, calculations, planning, references } = input;
  const suggestions = recommend(items, links, planning, references);
  const final = [
    ...validateAll(items, links, calculations),
    ...validatePlanning(items, planning),
  ];
  const proposed = {
    ...planning,
    allocations: [
      ...planning.allocations,
      ...suggestions.flatMap((r) =>
        r.allocation &&
        !planning.allocations.some((a) => a.id === r.allocation!.id)
          ? [r.allocation]
          : [],
      ),
    ],
  };
  const planningResults = discoverPlanning(items, proposed);
  const out: Finding[] = [];
  function append(r: Result, rec?: Recommendation) {
    const kind: Finding["kind"] = r.code.startsWith("CALC")
      ? "CALC"
      : r.code.startsWith("CROSS")
        ? "CROSS"
        : r.code.startsWith("ALLOC")
          ? "ALLOC"
          : "PLAN";
    const tolerance = r.unit === "원" ? 1 : 1e-8;
    const signal =
      r.difference === null
        ? "조건 확인"
        : Math.abs(r.difference) > tolerance
          ? "수치 차이"
          : "수치 일치";
    const a = r.evidence[0];
    const name = a
      ? a.field.startsWith("loan")
        ? `${loanIdentity(a) || "대출"} ${a.field === "loanRate" ? "금리" : a.field === "loanBalance" ? "잔액" : fieldLabels[a.field]}`
        : fieldLabels[a.field]
      : r.title;
    const title =
      kind === "CROSS"
        ? signal === "수치 차이"
          ? `${name} 수치가 두 문서에서 ${formatFinancial(Math.abs(r.difference!), r.unit === "%" ? "%p" : r.unit, { difference: true })} 다릅니다`
          : signal === "수치 일치"
            ? `${name} 수치가 일치하는 후보입니다`
            : `${name} 비교 조건을 확인해 주세요`
        : kind === "CALC"
          ? signal === "수치 차이"
            ? `${r.title}의 문서값과 추천 계산값이 다릅니다`
            : `${r.title}의 계산 범위를 확인해 주세요`
          : kind === "ALLOC"
            ? signal === "수치 차이" && r.difference! > 0
              ? "동일 자산의 동시 배정액이 보유액을 초과하는 후보입니다"
              : "동일 자산의 배정 관계와 사용 시점을 확인해 주세요"
            : r.code === "PLAN_CONDITIONAL"
              ? "조건부 금액이 현재 자금에 포함됐는지 확인해 주세요"
              : "제안과 실행 행동의 대상·기간을 확인해 주세요";
    const approved = final.find((f) => {
      if (rec?.link)
        return (
          f.id.startsWith("cross:") &&
          links.some(
            (l) =>
              f.id === `cross:${l.id}` &&
              l.xlsxId === rec.link!.xlsxId &&
              l.docxId === rec.link!.docxId,
          ) &&
          f.evidence.every((c) => c.confirmed)
        );
      if (rec?.calculation)
        return (
          f.id === `calc:${rec.calculation.id}` &&
          calculations.some(
            (c) => c.id === rec.calculation!.id && c.scopeConfirmed,
          ) &&
          f.evidence.every((c) => c.confirmed)
        );
      return f.id === r.id && (f.status === "오류" || f.status === "검증 통과");
    });
    const questions = [
      ...(kind === "CROSS"
        ? ["두 값이 같은 대상·같은 기준일·같은 시나리오의 값인가요?"]
        : kind === "CALC"
          ? ["추천된 구성에 누락이나 소계 중복이 없고 적용 기간이 같은가요?"]
          : []),
      ...r.needs,
      ...(rec?.risks ?? []),
    ];
    out.push({
      id: kind === "PLAN" || kind === "ALLOC" ? r.id : (rec?.id ?? r.id),
      kind,
      title: approved ? presentResult(approved).headline : title,
      signal,
      result: r,
      recommendation: rec,
      approved,
      primary:
        rec?.primary ??
        (r.id.startsWith("actions:") ||
          r.code === "ALLOC_CAPACITY" ||
          r.actual !== null),
      questions: [...new Set(questions)],
    });
  }
  for (const rec of suggestions) {
    if (rec.link)
      append(discoverCross(items, [{ id: rec.id, ...rec.link }])[0], rec);
    else if (rec.calculation)
      append(
        discoverCalculation(
          items,
          calculations.find((c) => c.id === rec.calculation!.id) ??
            rec.calculation,
        ),
        rec,
      );
  }
  for (const r of planningResults) {
    const rec = suggestions.find(
      (s) =>
        (s.planFocus &&
          (r.id === `fund:${s.planFocus.id}` ||
            r.id === `action:${s.planFocus.id}` ||
            (s.planFocus.kind === "actions" &&
              (r.id.startsWith(`actions:${s.planFocus.id}:`) ||
                r.id.endsWith(`:${s.planFocus.id}`))) ||
            (s.planFocus.kind === "allocations" &&
              planning.allocations.some(
                (a) =>
                  a.id === s.planFocus!.id &&
                  r.id ===
                    `alloc:${JSON.stringify([a.assetId, a.scenario.trim(), a.funding])}`,
              )))) ||
        (s.allocation &&
          r.references?.some((ref) =>
            s.references.some(
              (x) =>
                x.source === ref.source &&
                x.fileName === ref.fileName &&
                x.location === ref.location,
            ),
          )),
    );
    append(r, rec);
  }
  // 수동 구성만 존재하는 확정 결과도 자동 추천 목록에 가리지 않는다.
  for (const f of final.filter(
    (r) => r.status === "오류" || r.status === "검증 통과",
  ))
    if (!out.some((x) => x.approved?.id === f.id))
      out.push({
        id: `final:${f.id}`,
        kind: f.code.startsWith("CALC")
          ? "CALC"
          : f.code.startsWith("CROSS")
            ? "CROSS"
            : f.code.startsWith("ALLOC")
              ? "ALLOC"
              : "PLAN",
        title: presentResult(f).headline,
        signal: f.difference ? "수치 차이" : "조건 확인",
        result: f,
        approved: f,
        primary: true,
        questions: f.needs,
      });
  return out.sort(
    (a, b) =>
      Number(!!b.approved) - Number(!!a.approved) ||
      Number(b.signal === "수치 차이") - Number(a.signal === "수치 차이") ||
      Number(b.primary) - Number(a.primary),
  );
}
