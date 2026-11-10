import type { Finding } from "./analyze";
import type { ReviewDecision } from "./review";
import type { Candidate } from "../normalization/types";
import { coreFields } from "../recommendations/types";
import { loanIdentity } from "../recommendations/recommend";
import {
  assessRelationship,
  specificDate,
} from "../normalization/relationships";
export const qualityTiers = [
  "우선 검토",
  "추가 검토",
  "상세 분석 기록",
] as const;
export type QualityTier = (typeof qualityTiers)[number];
type InputFinding = Finding & { decision?: ReviewDecision };
export type QualityEntry = {
  finding: InputFinding;
  tier: QualityTier;
  reasons: string[];
  issueKey: string;
  occurrences: InputFinding[];
  supportCount: number;
};
const compact = (s: string) => s.replace(/\s/g, "");
const period = (s: string) =>
  ["월", "월간", "매월"].includes(compact(s))
    ? "월간"
    : ["연", "연간", "매년"].includes(compact(s))
      ? "연간"
      : compact(s);
/** 명시적 조건 충돌이나 현재/연도별 계획 혼합은 직접 숫자 비교보다 근거 확인을 우선한다. */
export function contextMismatch(f: InputFinding) {
  const p = f.result.evidence,
    r =
      f.relationship ??
      (f.kind === "CROSS" && p.length === 2
        ? assessRelationship(p[0], p[1])
        : undefined);
  return (
    (!!r && (r.periodConflict || r.dateConflict || r.scenarioConflict)) ||
    (f.kind === "CROSS" &&
      p.some((c) => /\d{4}/.test(c.period)) &&
      new Set(p.map((c) => period(c.period))).size > 1)
  );
}
/** 필터는 대표 검사 대상 항목에 적용한다. 숨긴 기록을 삭제하거나 판정을 변경하지 않는다. */
export function filterQuality(
  entries: QualityEntry[],
  field = "전체",
  kind = "전체",
) {
  return entries.filter(
    (e) =>
      (field === "전체" ||
        field === (e.finding.result.evidence[0]?.field ?? "planning")) &&
      (kind === "전체" || kind === e.finding.kind),
  );
}
const point = (c: Candidate | undefined) =>
  c
    ? [
        c.source,
        c.fileName,
        c.location,
        c.originalText,
        c.originalNumber,
        c.field,
        c.number,
        c.unit,
        c.normalizedValue,
        c.asOf,
        c.period,
        c.scenario,
        c.certainty,
        c.confirmed,
        c.confidence,
        c.method,
        c.excluded,
        c.method === "직접 입력" ? c.id : "",
      ]
    : null;
/** 같은 원본 쌍·관계·계산 범위·판정·근거가 모두 같을 때만 완전 중복으로 본다. */
export function exactFindingKey(f: InputFinding) {
  const r = f.result,
    s = f.recommendation?.calculation;
  return JSON.stringify([
    f.kind,
    r.code,
    r.title,
    ["PLAN", "ALLOC"].includes(f.kind) ? r.id : null,
    r.evidence.map(point),
    r.references ?? [],
    r.actual,
    r.expected,
    r.difference,
    r.unit,
    r.status,
    r.basis,
    r.needs,
    f.questions,
    f.relationship,
    s
      ? [
          s.rule,
          point(r.evidence.find((c) => c.id === s.targetId) ?? r.evidence[0]),
          Object.entries(s.groups)
            .sort()
            .map(([role, ids]) => [
              role,
              ids
                .map((id) => r.evidence.find((c) => c.id === id))
                .map((c) => (c ? point(c) : null)),
            ]),
          s.tolerance,
          s.loanMethod,
          s.loanBasis,
          s.graceMonths,
          s.scopeConfirmed,
        ]
      : null,
    f.decision?.choice,
    f.approved ? [f.approved.status, f.approved.basis, f.approved.needs] : null,
  ]);
}
function issueKey(f: InputFinding) {
  const r = f.result,
    c = r.evidence[0],
    dates = [
      ...new Set(
        r.evidence
          .map((c) => c.asOf)
          .filter(specificDate)
          .map(compact),
      ),
    ].sort(),
    scenarios = [
      ...new Set(r.evidence.map((c) => compact(c.scenario)).filter(Boolean)),
    ].sort();
  return JSON.stringify([
    f.kind,
    r.code,
    c?.field,
    c?.field.startsWith("loan") ? loanIdentity(c) : "",
    r.unit,
    r.evidence.map((c) => period(c.period)),
    dates,
    scenarios,
    r.actual,
    r.expected,
    f.decision?.choice,
  ]);
}
function assess(f: InputFinding): {
  tier: QualityTier;
  reasons: string[];
  score: number;
} {
  const r = f.approved ?? f.result,
    pair = f.result.evidence,
    relation =
      f.relationship ??
      (f.kind === "CROSS" && pair.length === 2
        ? assessRelationship(pair[0], pair[1])
        : undefined);
  if (f.decision?.choice === "different" || f.decision?.choice === "unknown")
    return {
      tier: qualityTiers[2],
      reasons: ["사용자가 다른 조건 또는 미확인으로 보류했습니다."],
      score: 0,
    };
  if (f.approved?.status === "오류")
    return {
      tier: qualityTiers[0],
      reasons: ["사용자 확인 후 기존 엔진이 오류로 판정했습니다."],
      score: 1000,
    };
  if (relation?.blocked)
    return { tier: qualityTiers[2], reasons: relation.reasons, score: 0 };
  if (
    f.kind === "CROSS" &&
    pair.some((c) => /\d{4}/.test(c.period)) &&
    new Set(pair.map((c) => period(c.period))).size > 1
  )
    return {
      tier: qualityTiers[2],
      reasons: ["연도별 계획과 현재 값의 적용 시점을 확인해야 합니다."],
      score: 0,
    };
  if (
    relation &&
    (relation.periodConflict ||
      relation.dateConflict ||
      relation.scenarioConflict)
  )
    return {
      tier: qualityTiers[2],
      reasons: [
        ...(relation.periodConflict
          ? [
              "적용 기간이 다릅니다. 현재·미래 또는 월간·연간을 직접 비교하지 않습니다.",
            ]
          : []),
        ...(relation.dateConflict ? ["명시된 기준일이 다릅니다."] : []),
        ...(relation.scenarioConflict ? ["명시된 시나리오가 다릅니다."] : []),
      ],
      score: 0,
    };
  if (r.status === "검증 불가")
    return { tier: qualityTiers[2], reasons: r.needs, score: 0 };
  if (f.approved?.status === "검증 통과" || f.signal === "수치 일치")
    return {
      tier: qualityTiers[2],
      reasons: [
        f.approved
          ? "사용자 확인 범위에서 통과한 검사 기록입니다."
          : "수치 일치 후보입니다. 자동으로 통과 처리하지 않습니다.",
      ],
      score: 0,
    };
  const proof =
    pair.length > 0 &&
    pair.every(
      (c) =>
        c.fileName &&
        c.location &&
        c.originalText &&
        c.normalizedValue !== null,
    );
  if (f.kind === "CROSS" && proof && f.signal === "수치 차이") {
    const a = pair[0],
      b = pair[1],
      core = coreFields.includes(a.field);
    const flow = ["income", "surplus"].includes(a.field),
      samePeriod = !!a.period && period(a.period) === period(b.period);
    const entity = a.field.startsWith("loan")
      ? !!loanIdentity(a) && loanIdentity(a) === loanIdentity(b)
      : /표/.test(b.location) ||
        pair.every((c) => c.confidence === "문맥 일치");
    if (
      core &&
      entity &&
      (!flow || (samePeriod && period(a.period) === "월간")) &&
      !pair.some((c) => c.certainty === "조건부")
    )
      return {
        tier: qualityTiers[0],
        reasons: [
          "핵심 재무 항목의 대상·단위·원본 근거가 연결됩니다.",
          "기준일·시나리오·확정 상태는 별도 사용자 확인 대상입니다.",
        ],
        score:
          100 +
          Number(f.primary) * 20 +
          Number(/표/.test(b.location)) * 10 +
          pair.filter((c) => c.confidence === "문맥 일치").length * 3 +
          pair.filter((c) => c.certainty === "확정").length * 2 +
          Number(!!a.asOf && a.asOf === b.asOf) * 5 +
          Number(!!a.scenario && a.scenario === b.scenario) * 5,
      };
    return {
      tier: qualityTiers[1],
      reasons: [
        flow && !samePeriod
          ? "흐름 항목의 적용 기간이 부족합니다."
          : "세부 항목의 범위·대상 동일성을 원문에서 확인하세요.",
      ],
      score: 10,
    };
  }
  if (
    f.kind === "CALC" &&
    proof &&
    f.signal === "수치 차이" &&
    !f.recommendation?.missing.length
  )
    return {
      tier: qualityTiers[0],
      reasons: [
        "동일 자료의 구조로 구성한 계산 차이입니다. 누락·소계 중복 여부는 확인이 필요합니다.",
      ],
      score: 90,
    };
  return {
    tier: qualityTiers[2],
    reasons: r.needs.length
      ? r.needs
      : ["관계·금액·기간이 충분하지 않아 추가 구조화가 필요합니다."],
    score: 0,
  };
}
/** 수치 크기를 순위에 사용하지 않는다. 중복 원본은 보존하고 대표 발견과 파생 기록만 구분한다. */
export function reviewQuality(findings: InputFinding[]): QualityEntry[] {
  const unique = new Map<string, QualityEntry>();
  for (const finding of findings) {
    const key = exactFindingKey(finding),
      existing = unique.get(key);
    if (existing) {
      existing.occurrences.push(finding);
      continue;
    }
    const quality = assess(finding);
    unique.set(key, {
      finding,
      tier: quality.tier,
      reasons: quality.reasons,
      issueKey: issueKey(finding),
      occurrences: [finding],
      supportCount: 0,
    });
  }
  const out = [...unique.values()],
    ranked = out
      .filter((e) => e.tier === qualityTiers[0])
      .sort((a, b) => assess(b.finding).score - assess(a.finding).score),
    representatives = new Map<string, QualityEntry>();
  for (const entry of ranked) {
    const previous = representatives.get(entry.issueKey);
    if (previous) {
      entry.tier = qualityTiers[2];
      entry.reasons = [
        "같은 발견을 지지하는 별도 원본·반복 출현 기록입니다. 개별 근거는 유지합니다.",
      ];
      previous.supportCount++;
    } else representatives.set(entry.issueKey, entry);
  }
  return out.sort(
    (a, b) =>
      qualityTiers.indexOf(a.tier) - qualityTiers.indexOf(b.tier) ||
      Number(b.finding.approved?.status === "오류") -
        Number(a.finding.approved?.status === "오류") ||
      assess(b.finding).score - assess(a.finding).score,
  );
}
