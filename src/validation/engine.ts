import type { Candidate, Link } from '../normalization/types';
import { normalize, compatibleUnit } from '../normalization/values';
import type { Calculation, Result } from './types';
import { rules, ruleTitles } from './types';
import { provisional } from './discovery';
import { representationSelection } from '../normalization/representations';
import { recurringConversion } from '../normalization/periods';
const money = (c: Candidate) => ['원', '만 원', '억 원'].includes(c.unit);
const compact = (s: string) => s.replace(/\s+/g, '');
const monthly = (s: string) => ['월', '월간', '매월'].includes(compact(s));
const annual = (s: string) => ['연', '연간', '매년'].includes(compact(s));
const flow = (c: Candidate) => ['income', 'fixedExpense', 'variableExpense', 'savings', 'surplus', 'loanPayment'].includes(c.field);
/** 입력 숫자를 재정규화해 누락·오래된 정규화 값·단위 오류를 검사한다. */
function inputIssues(items: Candidate[], discovery = false): string[] {
  return items.flatMap((c) => {
    const issues: string[] = [];
    if (c.excluded) issues.push(`${c.label}: 제외된 항목`);
    if (!discovery && !c.confirmed) issues.push(`${c.label}: 사용자 확인 필요`);
    if (c.field === 'unknown') issues.push(`${c.label}: 재무 항목 유형 확인 필요`);
    const v = normalize(c.number, c.unit);
    if (v === null || c.normalizedValue !== v || !compatibleUnit(c.field, c.unit))
      issues.push(`${c.label}: 숫자·단위 또는 정규화 값 확인 필요`);
    return issues;
  });
}
/** 날짜·시나리오는 명시적으로 일치해야 하며, 가정·조건부 값은 확정 판정을 보류한다. */
function contextIssues(items: Candidate[], checkPeriods: boolean): string[] {
  const issues: string[] = [];
  if (items.some((c) => c.certainty !== '확정')) issues.push('가정·조건부·미확인 상태인 입력의 확정 여부를 확인하세요.');
  for (const key of ['asOf', 'scenario'] as const) {
    const label = key === 'asOf' ? '기준일' : '시나리오';
    if (items.some((c) => !c[key].trim())) issues.push(`${label} 미확인`);
    else if (new Set(items.map((c) => compact(c[key]))).size > 1) issues.push(`${label} 불일치`);
  }
  if (checkPeriods) {
    const periods = items.map((c) => (monthly(c.period) ? '월간' : compact(c.period)));
    if (items.some((c) => flow(c) && !c.period.trim()) || (periods.some(Boolean) && periods.some((p) => !p)))
      issues.push('적용 기간 미확인');
    else if (new Set(periods).size > 1) issues.push('적용 기간 불일치');
  }
  return issues;
}
function verdict(result: Result, needs: string[], tolerance: number): Result {
  if (needs.length) return { ...result, status: '확인 필요', needs };
  return {
    ...result,
    status: Math.abs(result.difference!) <= tolerance ? '검증 통과' : '오류',
    needs: [],
  };
}
/** 원리금균등 월 상환액. 무이자는 원금/개월이며 잘못된 약정값은 null이다. */
export function annuityPayment(principal: number, annualPercent: number, months: number): number | null {
  if (
    !Number.isFinite(principal) ||
    principal < 0 ||
    principal > Number.MAX_SAFE_INTEGER ||
    !Number.isFinite(annualPercent) ||
    annualPercent < 0 ||
    !Number.isSafeInteger(months) ||
    months <= 0
  )
    return null;
  const rate = annualPercent / 1200;
  const value = rate === 0 ? principal / months : (principal * rate) / -Math.expm1(-months * Math.log1p(rate));
  return Number.isFinite(value) && value <= Number.MAX_SAFE_INTEGER ? value : null;
}
/** 추천·승인 경로의 수치 비교를 공유하고 모드에 따라 사용자 확인 게이트를 적용한다. */
function evaluateCross(items: Candidate[], links: Link[], discovery = false): Result[] {
  return links.map((link) => {
    const a = items.find((c) => c.id === link.xlsxId),
      b = items.find((c) => c.id === link.docxId);
    const evidence = [a, b].filter((c): c is Candidate => !!c);
    const result: Result = {
      id: `cross:${link.id}`,
      code: 'CROSS_VALUE',
      title: `문서 간 비교 · ${a?.label ?? '누락 항목'}`,
      status: '검증 불가',
      evidence,
      actual: null,
      expected: null,
      difference: null,
      unit: '',
      basis: `${discovery ? '추천된' : '승인된'} Excel·Word 동일 항목 연결 비교. 차이 = Excel − Word.`,
      needs: [],
    };
    if (!a || !b)
      return {
        ...result,
        needs: ['연결된 원본 항목이 없습니다. 연결을 다시 승인하세요.'],
      };
    const invalid = inputIssues(evidence, discovery);
    if (a.source !== 'XLSX' || b.source !== 'DOCX') invalid.push('Excel·Word 연결 방향 확인 필요');
    if (invalid.length) return { ...result, needs: invalid };
    if (a.field !== b.field)
      return {
        ...result,
        status: '확인 필요',
        needs: ['연결된 항목 유형이 다릅니다.'],
      };
    const dimension = (c: Candidate) => (money(c) ? '원' : c.unit === '년' || c.unit === '개월' ? '개월' : c.unit);
    if (dimension(a) !== dimension(b))
      return {
        ...result,
        status: '확인 필요',
        needs: ['비교 단위의 차원이 다릅니다.'],
      };
    const conversion = recurringConversion(a, b);
    const actual = a.normalizedValue! * (conversion?.a ?? (a.unit === '년' ? 12 : 1)),
      expected = b.normalizedValue! * (conversion?.b ?? (b.unit === '년' ? 12 : 1));
    const unit = dimension(a),
      difference = actual - expected;
    if (!Number.isFinite(difference) || Math.abs(actual) > Number.MAX_SAFE_INTEGER || Math.abs(expected) > Number.MAX_SAFE_INTEGER)
      return { ...result, needs: ['수치가 안전한 계산 범위를 초과합니다.'] };
    return verdict(
      {
        ...result,
        actual,
        expected,
        difference,
        unit,
        basis: `${result.basis} ${conversion ? `원문에 반복 금액이 명시되어 연간 기준 비교: Excel 원본 ${a.normalizedValue}원 × ${conversion.a}, Word 원본 ${b.normalizedValue}원 × ${conversion.b}. ` : ''}${actual} ${unit} − ${expected} ${unit} = ${difference} ${unit === '%' ? '%p' : unit}. 허용오차 ${unit === '원' ? 1 : 1e-8} ${unit === '%' ? '%p' : unit}.`,
      },
      contextIssues(evidence, !conversion),
      unit === '원' ? 1 : 1e-8,
    );
  });
}
/** 제공된 계산 범위의 공통 계산. 확인 게이트와 원본의 단위·조건 검사를 분리한다. */
function evaluateCalculation(items: Candidate[], spec: Calculation, discovery = false): Result {
  const originalIds = Object.values(spec.groups).flat();
  const duplicateInput = new Set([spec.targetId, ...originalIds]).size !== originalIds.length + 1;
  const selectedExcluded = items.filter((c) => originalIds.includes(c.id) && c.excluded);
  const expressionGroups = Object.fromEntries(
    Object.entries(spec.groups).map(([key, ids]) => [key, representationSelection(items.filter((c) => ids.includes(c.id)))]),
  );
  const expressionNotes = Object.values(expressionGroups).flatMap((g) => g.notes);
  const expressionConflicts = Object.values(expressionGroups).flatMap((g) => g.conflicts);
  spec = {
    ...spec,
    groups: Object.fromEntries(
      Object.entries(spec.groups).map(([key, ids]) => [
        key,
        expressionGroups[key].notes.length
          ? [...expressionGroups[key].items.map((c) => c.id), ...ids.filter((id) => !items.some((c) => c.id === id))]
          : ids,
      ]),
    ),
  };
  const config = rules[spec.rule],
    target = items.find((c) => c.id === spec.targetId);
  const selected = config.groups.flatMap((g) => spec.groups[g.key] ?? []);
  const ids = [spec.targetId, ...selected].filter(Boolean);
  const evidence = ids.map((id) => items.find((c) => c.id === id)).filter((c): c is Candidate => !!c);
  const result: Result = {
    id: `calc:${spec.id}`,
    code: `CALC_${spec.rule.toUpperCase()}`,
    title: spec.rule === 'surplus' && target && annual(target.period) ? '연간 순현금흐름' : ruleTitles[spec.rule],
    status: '검증 불가',
    evidence,
    references: expressionNotes.length
      ? items
          .filter((c) => originalIds.includes(c.id))
          .map((c) => ({ source: c.source, fileName: c.fileName, location: c.location, originalText: c.originalText }))
      : undefined,
    actual: target?.normalizedValue ?? null,
    expected: null,
    difference: null,
    unit: '원',
    basis: `${discovery ? '자동 추천한' : '사용자가 선택한'} 항목 범위에 한정한 계산 검증. 차이 = 문서값 − 계산값.`,
    needs: [],
  };
  const missing: string[] = [];
  if (duplicateInput) missing.push('같은 항목을 계산 내에서 중복 선택할 수 없습니다.');
  missing.push(...selectedExcluded.map((c) => `${c.label}: 제외된 항목`));
  if (expressionConflicts.length) missing.push(...expressionNotes.filter((s) => s.includes('불일치')));
  if (!target) missing.push(`검사할 ${ruleTitles[spec.rule]} 항목을 선택하세요.`);
  else if (target.field !== config.target) missing.push('검사 대상의 항목 유형을 확인하세요.');
  for (const group of config.groups) {
    const list = spec.groups[group.key] ?? [];
    if (!list.length || (!group.many && list.length !== 1))
      missing.push(`${group.label}: ${group.many ? '1개 이상' : '1개'} 선택 필요 (0원도 명시 입력 필요)`);
    for (const id of list) {
      const c = items.find((c) => c.id === id);
      if (!c) missing.push(`${group.label}: 원본 항목 없음`);
      else if (!group.fields.includes(c.field)) missing.push(`${group.label}: 항목 유형 불일치`);
    }
  }
  if (new Set(ids).size !== ids.length) missing.push('같은 항목을 계산 내에서 중복 선택할 수 없습니다.');
  missing.push(...inputIssues(evidence, discovery));
  const tolerance = spec.tolerance.trim() === '' ? NaN : Number(spec.tolerance);
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > Number.MAX_SAFE_INTEGER)
    missing.push('허용오차는 0 이상의 유한한 원 단위 숫자여야 합니다.');
  if (missing.length) return { ...result, needs: [...new Set(missing)] };
  const get = (key: string) => spec.groups[key].map((id) => items.find((c) => c.id === id)!);
  const value = (key: string) => get(key)[0].normalizedValue!;
  let unsafeSum = false;
  const sum = (key: string) =>
    get(key).reduce((n, c) => {
      const next = n + c.normalizedValue!;
      if (!Number.isSafeInteger(next)) unsafeSum = true;
      return next;
    }, 0);
  const needs = contextIssues(evidence, spec.rule !== 'loan');
  if (!spec.scopeConfirmed && !discovery) needs.push('선택 범위가 완전하며 소계·중복 항목을 포함하지 않는지 확인하세요.');
  if (new Set(evidence.map((c) => `${c.source}:${c.fileName}`)).size > 1)
    needs.push('계산 입력이 서로 다른 문서에 속합니다. 단일 문서의 범위를 선택하세요.');
  const moneyItems = spec.rule === 'loan' ? evidence.filter((c) => !['loanRate', 'loanTerm'].includes(c.field)) : evidence;
  if (moneyItems.some((c) => !money(c))) return { ...result, needs: ['금액 항목의 단위가 올바르지 않습니다.'] };
  if (spec.rule === 'surplus' && !evidence.every((c) => monthly(c.period)) && !evidence.every((c) => annual(c.period)))
    needs.push('잉여금에는 모든 입력을 같은 월간 또는 연간으로 확인해야 합니다. 기간을 임의로 환산하지 않습니다.');
  let expected: number | null = null,
    formula = '';
  if (spec.rule === 'assets' || spec.rule === 'debt') {
    expected = sum('parts');
    formula = `${ruleTitles[spec.rule]} = ${get('parts')
      .map((c) => c.normalizedValue)
      .join(' + ')}`;
  }
  if (spec.rule === 'net') {
    expected = value('assets') - value('debt');
    formula = `순자산 = ${value('assets')} − ${value('debt')}`;
  }
  if (spec.rule === 'surplus') {
    expected = value('income') - sum('expense') - sum('savings');
    formula = `${annual(target!.period) ? '연간 순현금흐름' : '월 잉여금'} = ${value('income')} − ${sum('expense')} − ${sum('savings')}`;
  }
  if (spec.rule === 'loan') {
    const principal = get('principal')[0],
      rate = get('rate')[0],
      term = get('term')[0];
    const months = term.normalizedValue! * (term.unit === '년' ? 12 : 1);
    if (spec.loanMethod !== '원리금균등') needs.push('원리금균등 상환방식을 확인하세요. 다른 상환방식은 현재 지원하지 않습니다.');
    if (spec.graceMonths.trim() === '' || !/^\d+$/.test(spec.graceMonths) || Number(spec.graceMonths) !== 0)
      needs.push('거치기간을 확인하세요. 현재는 거치기간 0개월인 약정만 지원합니다.');
    if (spec.loanBasis === '미확인') needs.push('최초 원금·전체 기간 또는 현재 잔액·잔여 기간의 조합을 확인하세요.');
    if (
      (spec.loanBasis === '최초 원금·전체 기간' && principal.field !== 'loanPrincipal') ||
      (spec.loanBasis === '현재 잔액·잔여 기간' && principal.field !== 'loanBalance')
    )
      needs.push('원금·잔액 유형과 선택한 기간 기준이 다릅니다.');
    if (!monthly(target!.period)) needs.push('문서 상환액의 월간 기준을 확인하세요.');
    const payment = annuityPayment(principal.normalizedValue!, rate.normalizedValue!, months);
    if (payment === null)
      return {
        ...result,
        needs: ['대출 원금은 0 이상, 연금리는 0 이상, 상환기간은 양의 정수 개월이어야 합니다.'],
      };
    formula = `원리금균등: P=${principal.normalizedValue}원, 연금리=${rate.normalizedValue}%, n=${months}개월. r=연금리/1200, P×r/[1−(1+r)^(-n)] (무이자 P/n). 기준=${spec.loanBasis}, 방식=${spec.loanMethod}, 거치=${spec.graceMonths || '미확인'}개월.`;
    // 불명확한 약정 조건에서는 참고 계산값도 확정값처럼 노출하지 않는다.
    if (needs.length) return { ...result, status: '확인 필요', basis: formula, needs };
    expected = Math.round(payment);
  }
  if (unsafeSum || expected === null || !Number.isFinite(expected) || Math.abs(expected) > Number.MAX_SAFE_INTEGER)
    return { ...result, needs: ['계산 결과가 안전한 숫자 범위를 초과합니다.'] };
  const difference = target!.normalizedValue! - expected;
  if (!Number.isSafeInteger(difference)) return { ...result, needs: ['차이가 안전한 숫자 범위를 초과합니다.'] };
  return verdict(
    {
      ...result,
      expected,
      difference,
      basis: `${formula} = ${expected}원. 차이 ${difference}원. 허용오차 ${tolerance}원. ${expressionNotes.join(' ')}`.trim(),
    },
    needs,
    tolerance,
  );
}
/** 사용자 승인 연결만 확정 검증에 사용한다. */
export function validateCross(items: Candidate[], links: Link[]): Result[] {
  return evaluateCross(items, links);
}
/** 기존 사용자 확인·범위 승인 조건을 그대로 적용한다. */
export function validateCalculation(items: Candidate[], spec: Calculation): Result {
  return evaluateCalculation(items, spec);
}
/** 추천 연결의 숫자 차이만 분석하며 원본 확인·연결 승인을 변경하지 않는다. */
export function discoverCross(items: Candidate[], links: Link[]): Result[] {
  return evaluateCross(items, links, true).map(provisional);
}
/** 추천 계산 범위의 참고값을 구한다. 불명확한 대출 약정은 기존처럼 보류한다. */
export function discoverCalculation(items: Candidate[], spec: Calculation): Result {
  return provisional(evaluateCalculation(items, spec, true));
}
/** 설정된 계산과 승인된 연결을 독립적으로 처리하므로 전체 후보 확인을 요구하지 않는다. */
export function validateAll(items: Candidate[], links: Link[], calculations: Calculation[]): Result[] {
  return [...calculations.map((spec) => validateCalculation(items, spec)), ...validateCross(items, links)];
}
