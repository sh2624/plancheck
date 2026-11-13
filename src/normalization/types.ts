export const fieldLabels = {
  income: '월 실수령 소득',
  fixedExpense: '고정지출',
  variableExpense: '변동지출',
  savings: '저축·투자액',
  surplus: '잉여금',
  totalAssets: '총자산',
  totalDebt: '총부채',
  netAssets: '순자산',
  deposit: '예금·적금',
  etf: 'ETF',
  pension: '퇴직연금',
  housingDeposit: '보증금',
  loanPrincipal: '대출 원금',
  loanBalance: '대출 잔액',
  loanRate: '대출 연금리',
  loanPayment: '대출 상환액',
  loanTerm: '대출 기간',
  goal: '재무목표',
  goalAmount: '목표액',
  fundingSource: '자금 출처',
  deadline: '기한',
  unknown: '미분류',
} as const;
export type Field = keyof typeof fieldLabels;
export const units = ['원', '만 원', '억 원', '%', '개월', '년', '미확인'] as const;
export type Unit = (typeof units)[number];
export type Candidate = {
  valueRole?: string;
  representation?: { key: string; memberIds: string[] };
  contextEvidence?: import('./context').ContextEvidence[];
  unitEvidence?: import('./unitContext').UnitEvidence;
  id: string;
  source: 'XLSX' | 'DOCX';
  fileName: string;
  location: string;
  originalText: string;
  originalNumber: string | null;
  label: string;
  number: string;
  unit: Unit;
  normalizedValue: number | null;
  field: Field;
  asOf: string;
  period: string;
  scenario: string;
  certainty: '확정' | '가정' | '조건부' | '미확인';
  confirmed: boolean;
  excluded: boolean;
  method: '행·열 문맥' | '문단 근접 문맥' | '직접 입력';
  confidence: '문맥 일치' | '확인 필요';
  note: string;
};
export type Link = { id: string; xlsxId: string; docxId: string };
