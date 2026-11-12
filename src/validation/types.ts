import type { Candidate, Field } from '../normalization/types';
export const ruleTitles = {
  assets: '총자산 합계',
  debt: '총부채 합계',
  net: '순자산',
  surplus: '월 잉여금',
  loan: '대출 월 상환액',
} as const;
export type Rule = keyof typeof ruleTitles;
export type EvidenceRef = {
  source: Candidate['source'];
  fileName: string;
  location: string;
  originalText: string;
};
export type Status = '오류' | '확인 필요' | '검증 통과' | '검증 불가';
export type Calculation = {
  id: string;
  rule: Rule;
  targetId: string;
  groups: Record<string, string[]>;
  scopeConfirmed: boolean;
  tolerance: string;
  loanMethod: '미확인' | '원리금균등' | '기타';
  graceMonths: string;
  loanBasis: '미확인' | '최초 원금·전체 기간' | '현재 잔액·잔여 기간';
};
export type Result = {
  /** 명시된 원문 관계의 확인 질문이며 확정 판정을 대신하지 않는다. */
  reviewHint?: { title: string; question: string };
  id: string;
  code: string;
  title: string;
  status: Status;
  evidence: Candidate[];
  references?: EvidenceRef[];
  actual: number | null;
  expected: number | null;
  difference: number | null;
  unit: string;
  basis: string;
  needs: string[];
};
export const rules: Record<
  Rule,
  {
    target: Field;
    groups: { key: string; label: string; fields: Field[]; many: boolean }[];
  }
> = {
  assets: {
    target: 'totalAssets',
    groups: [
      {
        key: 'parts',
        label: '자산 구성 항목 (합계·소계와 중복 선택 금지)',
        fields: ['deposit', 'etf', 'pension', 'housingDeposit'],
        many: true,
      },
    ],
  },
  debt: {
    target: 'totalDebt',
    groups: [
      {
        key: 'parts',
        label: '부채 잔액 항목',
        fields: ['loanBalance'],
        many: true,
      },
    ],
  },
  net: {
    target: 'netAssets',
    groups: [
      { key: 'assets', label: '총자산', fields: ['totalAssets'], many: false },
      { key: 'debt', label: '총부채', fields: ['totalDebt'], many: false },
    ],
  },
  surplus: {
    target: 'surplus',
    groups: [
      { key: 'income', label: '월 소득', fields: ['income'], many: false },
      {
        key: 'expense',
        label: '월 지출 (대출 상환 포함 여부 확인)',
        fields: ['fixedExpense', 'variableExpense', 'loanPayment'],
        many: true,
      },
      {
        key: 'savings',
        label: '월 저축·투자',
        fields: ['savings'],
        many: true,
      },
    ],
  },
  loan: {
    target: 'loanPayment',
    groups: [
      {
        key: 'principal',
        label: '약정 원금 또는 현재 잔액',
        fields: ['loanPrincipal', 'loanBalance'],
        many: false,
      },
      { key: 'rate', label: '연금리 (%)', fields: ['loanRate'], many: false },
      {
        key: 'term',
        label: '전체 또는 잔여 상환기간',
        fields: ['loanTerm'],
        many: false,
      },
    ],
  },
};
/** 계산 항목은 자동 선택하지 않고 모든 필수 입력을 미확인으로 시작한다. */
export function newCalculation(rule: Rule, id: string): Calculation {
  return {
    id,
    rule,
    targetId: '',
    groups: {},
    scopeConfirmed: false,
    tolerance: '1',
    loanMethod: '미확인',
    graceMonths: '',
    loanBasis: '미확인',
  };
}
