import type { Candidate, Field, Unit } from "./types";
/** 빈 값과 파싱 실패는 null로 유지하고 금액은 원, 금리는 %, 기간은 선택 단위로 변환한다. */
export function normalize(number: string, unit: Unit): number | null {
  const input = number.trim();
  if (input.includes(",") && !/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(input))
    return null;
  const text = input.replaceAll(",", "");
  if (
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ||
    unit === "미확인"
  )
    return null;
  const value =
    Number(text) *
    (unit === "만 원" ? 10000 : unit === "억 원" ? 100000000 : 1);
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
    return null;
  return ["원", "만 원", "억 원"].includes(unit) ? Math.round(value) : value;
}
/** 편집 시 확인을 해제하고 단위 변환 결과를 다시 계산한다. */
export function editCandidate(
  item: Candidate,
  patch: Partial<Candidate>,
): Candidate {
  const next = { ...item, ...patch, confirmed: false };
  return { ...next, normalizedValue: normalize(next.number, next.unit) };
}
/** 금리·기간·금액 유형에 맞는 단위인지 확인한다. */
export function compatibleUnit(field: Field, unit: Unit) {
  if (field === "loanRate") return unit === "%";
  if (field === "loanTerm") return unit === "개월" || unit === "년";
  if (["goal", "fundingSource", "deadline"].includes(field)) return true;
  return ["원", "만 원", "억 원"].includes(unit);
}
/** 숫자형 후보의 잘못된 입력과 단위는 확인 완료 처리하지 않는다. */
export function canConfirm(item: Candidate) {
  if (item.field === "unknown") return false;
  return (
    !!item.label.trim() &&
    !item.excluded &&
    (["goal", "fundingSource", "deadline"].includes(item.field) ||
      (item.normalizedValue !== null && compatibleUnit(item.field, item.unit)))
  );
}
export function unitOf(text: string): Unit {
  if (/억\s*원/.test(text)) return "억 원";
  if (/만\s*원/.test(text)) return "만 원";
  if (/%/.test(text)) return "%";
  if (/개월/.test(text)) return "개월";
  if (/원/.test(text)) return "원";
  if (/년/.test(text)) return "년";
  return "미확인";
}
/** 항목명에 근거해 분류하며 진단 비율·비교식은 금액 항목으로 분류하지 않는다. */
export function classify(text: string): Field | null {
  const t = text.replaceAll(" ", "");
  if (
    /지표|비중|소득대비|총자산대비|÷|부담률|성향|세율|예금.*금리|이자절감|월이자/.test(
      t,
    )
  )
    return null;
  if (/대출|학자금/.test(t)) {
    if (/금리|연이율/.test(t)) return "loanRate";
    if (/기간|개월/.test(t)) return "loanTerm";
    if (/상환액|원리금/.test(t)) return "loanPayment";
    if (/상환방식/.test(t)) return null;
    if (/원금/.test(t)) return "loanPrincipal";
    return "loanBalance";
  }
  if (/순자산/.test(t)) return "netAssets";
  if (/총자산|자산합계/.test(t)) return "totalAssets";
  if (/총부채|부채합계/.test(t)) return "totalDebt";
  if (/실수령|월소득/.test(t)) return "income";
  if (/잉여|여유자금/.test(t)) return "surplus";
  if (/고정지출/.test(t)) return "fixedExpense";
  if (/변동지출/.test(t)) return "variableExpense";
  if (/퇴직연금|\bDC\b/.test(t)) return "pension";
  if (/저축·투자|적립|월납입|총저축|노후대비저축/.test(t)) return "savings";
  if (/보증금/.test(t)) return "housingDeposit";
  if (/ETF/i.test(t)) return "etf";
  if (/예금|적금/.test(t)) return "deposit";
  if (/목표액|목표금액/.test(t)) return "goalAmount";
  if (/결혼자금|비상자금|의료비예비비|전세자금/.test(t)) return "goalAmount";
  if (/재원|자금출처/.test(t)) return "fundingSource";
  if (/기한|목표시점/.test(t)) return "deadline";
  if (/목표/.test(t)) return "goal";
  return null;
}
