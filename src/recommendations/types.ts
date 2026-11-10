import type { Candidate } from "../normalization/types";
import type { Calculation, EvidenceRef } from "../validation/types";
import type { Allocation } from "../planning/types";
export type Recommendation = {
  scopeIssues?: string[];
  reviewed?: boolean;
  id: string;
  kind: "CALC" | "CROSS" | "ALLOC" | "PLAN";
  title: string;
  candidateIds: string[];
  reason: string;
  risks: string[];
  missing: string[];
  confidence: "구조 일치" | "원문 검토 필요" | "정보 부족";
  primary: boolean;
  calculation?: Calculation;
  link?: { xlsxId: string; docxId: string };
  allocation?: Allocation;
  planFocus?: { kind: "allocations" | "funds" | "actions"; id: string };
  references: EvidenceRef[];
};
export const coreFields: Candidate["field"][] = [
  "income",
  "totalAssets",
  "totalDebt",
  "netAssets",
  "surplus",
  "loanRate",
  "loanBalance",
];
