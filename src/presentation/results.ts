import type { Candidate } from "../normalization/types";
import { fieldLabels } from "../normalization/types";
import type { Result } from "../validation/types";
import { loanIdentity } from "../recommendations/recommend";
const number = (value: number, min = 0) =>
  value.toLocaleString("ko-KR", {
    minimumFractionDigits: min,
    maximumFractionDigits:
      value !== 0 && Math.abs(value) < 0.01 ? 12 : Math.max(min, 2),
  });
/** 값은 변경하지 않고 사용자에게 표시할 단위와 자릿수만 정리한다. */
export function displayValue(value: number | null, unit: string) {
  return value === null
    ? "—"
    : `${number(value)}${unit === "%" || unit === "%p" ? "" : " "}${unit}`.trim();
}
function nameOf(c: Candidate | undefined) {
  if (!c) return "연결된 항목";
  if (c.field === "loanRate") return `${loanIdentity(c) || "대출"} 금리`;
  if (c.field === "loanBalance") return `${loanIdentity(c) || "대출"} 잔액`;
  if (
    ["income", "totalAssets", "totalDebt", "netAssets", "surplus"].includes(
      c.field,
    )
  )
    return fieldLabels[c.field];
  return c.label.split(" · ").at(-1) || fieldLabels[c.field];
}
function subject(name: string) {
  const last = name.charCodeAt(name.length - 1);
  return (
    name + (last >= 44032 && last <= 55203 && (last - 44032) % 28 ? "이" : "가")
  );
}
/** 엔진 상태·계산값을 그대로 두고 이해하기 쉬운 제목, 설명, 다음 행동을 제공한다. */
export function presentResult(r: Result) {
  const name = nameOf(r.evidence[0]);
  if (r.status === "검증 불가")
    return {
      headline: `${r.code === "CROSS_VALUE" ? name : r.title} · 검증 준비 중`,
      description:
        "아직 필요한 값이나 사용자 확인이 준비되지 않았습니다. 오류로 판정한 결과가 아닙니다.",
      nextAction: r.needs[0] ?? "추천 검토에서 필요한 항목만 확인하세요.",
    };
  if (r.status === "확인 필요")
    return {
      headline: `${r.code === "CROSS_VALUE" ? name : r.title} · 추가 확인이 필요합니다`,
      description:
        "계산 또는 숫자 차이는 확인했지만 적용 기준·조건이 명확하지 않아 오류를 확정하지 않았습니다.",
      nextAction:
        r.needs[0] ?? "원본의 기준일·기간·시나리오와 확정 상태를 확인하세요.",
    };
  if (r.code === "CROSS_VALUE") {
    const description = `Excel ${displayValue(r.actual, r.unit)}, Word ${displayValue(r.expected, r.unit)}. 차이 ${displayValue(r.difference === null ? null : Math.abs(r.difference), r.unit === "%" ? "%p" : r.unit)}.`;
    if (r.status === "검증 통과")
      return {
        headline: `${subject(name)} 두 문서에서 일치합니다.`,
        description,
        nextAction:
          "확인한 동일 항목의 비교만 통과했습니다. 다른 항목의 정상 여부까지 뜻하지 않습니다.",
      };
    return {
      headline:
        r.unit === "%"
          ? `${subject(name)} ${number(Math.abs(r.difference ?? 0), 1)}%p 차이 납니다.`
          : `${subject(name)} 두 문서에서 다릅니다.`,
      description,
      nextAction:
        "두 원본의 수치와 적용 기준을 대조하고 잘못된 문서를 수정하세요.",
    };
  }
  if (r.code === "ALLOC_CAPACITY") {
    const asset = r.evidence.find((c) =>
      ["deposit", "etf", "pension", "housingDeposit"].includes(c.field),
    );
    return {
      headline:
        r.status === "오류"
          ? `${subject(nameOf(asset))} 여러 목표에 중복 배정됐습니다.`
          : "선택한 자산의 동시 배정액이 보유액 이내입니다.",
      description: `최대 동시 배정 ${displayValue(r.actual, "원")}, 보유액 ${displayValue(r.expected, "원")}, 차이 ${displayValue(r.difference, "원")}.`,
      nextAction:
        r.status === "오류"
          ? "겹치는 배정액을 줄이거나 실제 사용 기간·자금 출처를 다시 확인하세요."
          : "순차 사용 후 원금 소진과 미래 적립금은 별도 확인이 필요합니다.",
    };
  }
  if (r.code === "PLAN_CONDITIONAL")
    return {
      headline:
        r.status === "오류"
          ? "아직 확정되지 않은 금액이 현재 자금에 포함됐습니다."
          : "조건부 금액의 현재 반영 구분을 확인했습니다.",
      description: r.title,
      nextAction:
        r.status === "오류"
          ? "승인·수령 여부를 확인하고 미확정 금액을 현재 확정 자산·수입에서 분리하세요."
          : "수령 시점과 실제 가용 현금 여부는 원문에서 별도로 확인하세요.",
    };
  if (r.code === "PLAN_CONFLICT")
    return {
      headline:
        r.status === "오류"
          ? "같은 대상의 제안과 실행 행동이 충돌합니다."
          : "비교한 제안과 실행에서 행동 충돌이 확인되지 않았습니다.",
      description: r.title,
      nextAction:
        r.status === "오류"
          ? "유지·중단 등 행동과 적용 기간·시나리오를 원본에서 다시 맞추세요."
          : "다른 대상과 다른 기간의 계획까지 통과한 것은 아닙니다.",
    };
  return {
    headline:
      r.status === "오류"
        ? `${r.title} 계산값이 문서 수치와 다릅니다.`
        : `${r.title} 계산이 문서 수치와 일치합니다.`,
    description: `문서 ${displayValue(r.actual, r.unit)}, 계산 ${displayValue(r.expected, r.unit)}, 차이 ${displayValue(r.difference, r.unit)}.`,
    nextAction:
      r.status === "오류"
        ? "선택한 구성 항목·단위·범위를 확인하고 합계 또는 계산식을 수정하세요."
        : "선택한 계산 범위에 한정한 통과입니다.",
  };
}
