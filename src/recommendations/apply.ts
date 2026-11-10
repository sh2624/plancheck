import type { Candidate, Link } from "../normalization/types";
import type { Calculation } from "../validation/types";
import { rules } from "../validation/types";
import { canConfirm } from "../normalization/values";
import type { Recommendation } from "./types";
export type ReviewState = {
  items: Candidate[];
  links: Link[];
  calculations: Calculation[];
};
/** 추천 구성 적용과 사용자 승인 액션을 분리하며, 대상에 포함되지 않은 후보는 변경하지 않는다. */
export function applyRecommendation(
  state: ReviewState,
  r: Recommendation,
  approve: boolean,
): ReviewState {
  const selected = r.candidateIds.map((id) =>
    state.items.find((c) => c.id === id),
  );
  if (
    approve &&
    (!selected.length || selected.some((c) => !c || !canConfirm(c)))
  )
    return state;
  if (
    approve &&
    r.calculation &&
    !rules[r.calculation.rule].groups.every(
      (g) =>
        (r.calculation!.groups[g.key]?.length ?? 0) > 0 &&
        (g.many || r.calculation!.groups[g.key].length === 1),
    )
  )
    return state;
  let links = state.links,
    calculations = state.calculations;
  if (r.link && approve) {
    const x = selected.find((c) => c?.id === r.link!.xlsxId),
      d = selected.find((c) => c?.id === r.link!.docxId);
    if (x?.source !== "XLSX" || d?.source !== "DOCX") return state;
    if (!links.some((l) => l.xlsxId === x.id && l.docxId === d.id))
      links = [
        ...links,
        { id: `approved:${r.id}`, xlsxId: x.id, docxId: d.id },
      ];
  }
  if (r.calculation) {
    const previous = calculations.find((c) => c.id === r.calculation!.id),
      same =
        previous &&
        JSON.stringify(previous.groups) ===
          JSON.stringify(r.calculation.groups) &&
        previous.targetId === r.calculation.targetId;
    const next = {
      ...r.calculation,
      ...(same
        ? {
            tolerance: previous.tolerance,
            loanMethod: previous.loanMethod,
            loanBasis: previous.loanBasis,
            graceMonths: previous.graceMonths,
          }
        : {}),
      groups: Object.fromEntries(
        Object.entries(r.calculation.groups).map(([k, v]) => [k, [...v]]),
      ),
      scopeConfirmed: approve,
    };
    calculations = [
      ...calculations.filter(
        (c) =>
          c.id !== next.id &&
          !(
            c.id === next.rule &&
            !c.targetId &&
            Object.values(c.groups).every((ids) => !ids.length)
          ),
      ),
      next,
    ];
  }
  return {
    ...state,
    links,
    calculations,
    items: approve
      ? state.items.map((c) =>
          r.candidateIds.includes(c.id) ? { ...c, confirmed: true } : c,
        )
      : state.items,
  };
}
