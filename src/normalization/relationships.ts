import type { Candidate } from './types';
import { recurringConversion } from './periods';
export type RelationshipAssessment = {
  blocked: boolean;
  reasons: string[];
  periodConflict: boolean;
  dateConflict: boolean;
  scenarioConflict: boolean;
};
const compact = (s: string) => s.replace(/\s/g, '');
const period = (s: string) =>
  ['월', '월간', '매월'].includes(compact(s)) ? '월간' : ['연', '연간', '매년'].includes(compact(s)) ? '연간' : compact(s);
export const specificDate = (s: string) => /\d{4}/.test(s) && /[-./년]/.test(s);
const savingsRow = (c: Candidate) => /^저축\s*[·/ㆍ-]?\s*투자/.test(c.label) || /^\s*저축\s*[·/ㆍ-]?\s*투자\s*[|·:]/.test(c.originalText);
function atoms(c: Candidate) {
  const labels: [string, RegExp][] = ['fixedExpense', 'variableExpense'].includes(c.field)
    ? [
        ['임차료', /월세|임차료/],
        ['공과금', /관리비|공과금/],
        ['통신비', /통신/],
        ['교통비', /교통/],
        ['보험료', /보험료/],
        ['가족지원', /생활비.*의료비|의료비.*지원/],
        ['식비', /식비/],
        ['생활용품', /생활용품|의류/],
        ['여가', /여가|자기계발/],
        ['경조사', /경조사|명절/],
      ]
    : [
        ['예금', /예금/],
        ['입출금통장', /입출금통장/],
        ['CMA', /CMA/i],
        ['적금', /적금/],
        ['청약', /청약/],
        ['투자자산', /ETF|주식/i],
        ['퇴직연금', /퇴직연금|\bDC\b/],
        ['연금저축', /연금저축/],
        ['IRP', /\bIRP\b/],
        ['보증금', /보증금/],
      ];
  return labels.filter(([, pattern]) => pattern.test(c.label)).map(([name]) => name);
}
/** 원본 명칭의 범위와 명시된 조건만 비교한다. 숫자의 같고 다름은 관계 판단에 사용하지 않는다. */
export function assessRelationship(a: Candidate, b: Candidate): RelationshipAssessment {
  const reasons: string[] = [],
    x = atoms(a),
    y = atoms(b);
  if (a.field === 'income') {
    const kind = (c: Candidate) =>
      /총유입/.test(c.label) ? '총유입' : /기타소득/.test(c.label) ? '기타소득' : /근로소득/.test(c.label) ? '근로소득' : '';
    if (kind(a) && kind(b) && kind(a) !== kind(b)) reasons.push('소득 세부 항목과 총유입의 범위가 다릅니다.');
  }
  const expenseScope = (c: Candidate) =>
    /월\s*(?:총\s*)?지출/.test(c.label) ? '전체 지출' : /고정지출/.test(c.label) ? '고정지출' : /변동지출/.test(c.label) ? '변동지출' : '';
  if (expenseScope(a) && expenseScope(b) && expenseScope(a) !== expenseScope(b))
    reasons.push('전체 월 지출과 고정·변동 지출의 범위가 다릅니다.');
  if (a.field === 'loanPayment' && [a, b].some((c) => /상환방식|상환유형|방식\s*코드/.test(c.label)))
    reasons.push('상환방식 코드와 상환액은 다른 항목입니다.');
  if (['deposit', 'etf', 'pension', 'housingDeposit', 'savings', 'fixedExpense', 'variableExpense'].includes(a.field)) {
    if (x.length && y.length && (x.some((v) => !y.includes(v)) || y.some((v) => !x.includes(v))))
      reasons.push('서로 다른 세부 항목 또는 개별 항목과 묶음 금액입니다. 동일 항목으로 자동 연결하지 않습니다.');
    if (
      ['fixedExpense', 'variableExpense', 'savings'].includes(a.field) &&
      /소계|합계|총계/.test(a.label) !== /소계|합계|총계/.test(b.label)
    )
      reasons.push('합계·소계와 개별 구성 항목의 범위가 다릅니다.');
  }
  if (['deposit', 'etf', 'pension', 'housingDeposit'].includes(a.field) && savingsRow(a) !== savingsRow(b))
    reasons.push('보유 자산과 저축·투자 납입액의 역할이 다릅니다.');
  const periodConflict =
      (!!a.period.trim() && !!b.period.trim() && period(a.period) !== period(b.period) && !recurringConversion(a, b)) ||
      /\d+\s*(?:년|개월)\s*후/.test(a.period) !== /\d+\s*(?:년|개월)\s*후/.test(b.period),
    dateConflict = specificDate(a.asOf) && specificDate(b.asOf) && compact(a.asOf) !== compact(b.asOf),
    scenarioConflict = !!a.scenario.trim() && !!b.scenario.trim() && compact(a.scenario) !== compact(b.scenario);
  return {
    blocked: reasons.length > 0,
    reasons,
    periodConflict,
    dateConflict,
    scenarioConflict,
  };
}
