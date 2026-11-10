import type { Candidate, Link, Field } from '../normalization/types';
import { compatibleUnit, unitOf, normalize } from '../normalization/values';
import { suggestLinks } from '../normalization/links';
import { newCalculation, rules, ruleTitles } from '../validation/types';
import type { Rule, EvidenceRef } from '../validation/types';
import { newRecord } from '../planning/types';
import { dateValue } from '../planning/engine';
import type { Planning } from '../planning/types';
import { coreFields } from './types';
import type { Recommendation } from './types';
const monthly = (s: string) => ['월', '월간', '매월'].includes(s.trim());
const active = (c: Candidate) => !c.excluded;
const party = (c: Candidate) => (c.label.match(/본인|고객|어머니|아버지|배우자|자녀/)?.[0] ?? '').replace('고객', '본인');
const comparable = (c: Candidate) => active(c) && c.normalizedValue !== null && compatibleUnit(c.field, c.unit);
/** 같은 표·시트의 구조를 이용하며 특정 문서명이나 셀 주소를 사용하지 않는다. */
export function region(c: Candidate): string {
  return c.source === 'XLSX' ? c.location.split('!')[0] : (c.location.match(/^(?:본문\s*)?표\s*\d+/)?.[0] ?? c.location.split(' · ')[0]);
}
function sameRegion(a: Candidate, b: Candidate) {
  return a.source === b.source && a.fileName === b.fileName && region(a) === region(b);
}
/** 금액 대신 대출 명칭으로 약정 후보를 구분한다. 이름을 알 수 없으면 연결하지 않는다. */
export function loanIdentity(c: Candidate): string {
  return c.label.match(/(?:^|[\s·])([^\s·()]*(?:대출|학자금)[^\s·()]*)/)?.[1] ?? '';
}
const dedupe = (values: string[]) => [...new Set(values)];
function contextRisks(items: Candidate[]): string[] {
  const out: string[] = [];
  for (const key of ['asOf', 'scenario'] as const) {
    const label = key === 'asOf' ? '기준일' : '시나리오';
    if (items.some((c) => !c[key].trim())) out.push(`${label} 미확인`);
    else if (new Set(items.map((c) => c[key].replace(/\s/g, ''))).size > 1) out.push(`${label} 다름 · 동일 기준으로 간주하지 않습니다.`);
  }
  const periods = items.map((c) => (monthly(c.period) ? '월간' : c.period.trim()));
  if (new Set(periods).size > 1) out.push('월·연 또는 적용 기간이 다릅니다.');
  if (items.some((c) => c.certainty !== '확정')) out.push('가정·조건부·미확인 상태를 원문과 대조하세요.');
  if (items.some((c) => c.confidence === '확인 필요')) out.push('근접 문맥 추출 또는 모호한 단위·대상입니다.');
  return out;
}
function constituent(items: Candidate[], field: Field) {
  const selected = items.filter((c) => c.field === field),
    totals = selected.filter((c) => /소계|합계|총저축/.test(c.label));
  return totals.length ? totals : selected.filter((c) => !/[+＋]|참고|소계|합계/.test(c.label));
}
/** 원문 구조가 맞는 계산을 제안하되 범위 확인이나 사용자 확인은 절대 부여하지 않는다. */
function calculations(items: Candidate[]): Recommendation[] {
  const output: Recommendation[] = [];
  for (const rule of Object.keys(rules) as Rule[])
    for (const target of items.filter((c) => active(c) && c.field === rules[rule].target)) {
      if (rule === 'surplus' && !monthly(target.period)) continue;
      if (rule === 'loan' && !monthly(target.period)) continue;
      const local = items.filter((c) => active(c) && sameRegion(c, target) && c.id !== target.id);
      const candidates = rule === 'surplus' ? local.filter((c) => monthly(c.period)) : local;
      const spec = newCalculation(rule, `recommended:${rule}:${target.id}`);
      spec.targetId = target.id;
      const risks: string[] = [],
        missing: string[] = [],
        scopeIssues: string[] = [];
      if (rule === 'assets')
        spec.groups.parts = candidates
          .filter((c) => ['deposit', 'etf', 'pension', 'housingDeposit'].includes(c.field) && !/[+＋]|소계|합계|참고/.test(c.label))
          .map((c) => c.id);
      if (rule === 'debt')
        spec.groups.parts = candidates.filter((c) => c.field === 'loanBalance' && !/소계|합계|참고/.test(c.label)).map((c) => c.id);
      if (rule === 'net') {
        spec.groups.assets = candidates.filter((c) => c.field === 'totalAssets').map((c) => c.id);
        spec.groups.debt = candidates.filter((c) => c.field === 'totalDebt').map((c) => c.id);
      }
      if (rule === 'surplus') {
        spec.groups.income = candidates.filter((c) => c.field === 'income').map((c) => c.id);
        spec.groups.expense = [
          ...constituent(candidates, 'fixedExpense'),
          ...constituent(candidates, 'variableExpense'),
          ...candidates.filter((c) => c.field === 'loanPayment'),
        ].map((c) => c.id);
        const inclusive = candidates.filter(
          (c) =>
            ['fixedExpense', 'variableExpense'].includes(c.field) &&
            /생활비\s*합계|총지출|지출\s*합계/.test(c.label) &&
            /고정.*변동/.test(c.label) &&
            /부채|상환/.test(c.label),
        );
        if (inclusive.length === 1) spec.groups.expense = [inclusive[0].id];
        if (inclusive.length > 1) scopeIssues.push('지출 총합 후보가 여러 개입니다. 구성 범위를 선택하세요.');
        if (
          candidates.some(
            (c) => ['deposit', 'etf', 'pension'].includes(c.field) && /^\s*저축\s*[·/ㆍ-]?\s*투자\s*[|·:]/.test(c.originalText),
          )
        )
          scopeIssues.push('저축 행의 일부 값이 자산 유형으로 추출됐습니다. 항목 유형과 누락된 저축 구성을 확인하세요.');
        spec.groups.savings = constituent(candidates, 'savings').map((c) => c.id);
        risks.push('월 지출과 저축의 누락·소계 중복 여부를 확인하세요.');
        missing.push(...scopeIssues);
      }
      if (rule === 'loan') {
        const entity = loanIdentity(target);
        const sameLoan = items.filter(
          (c) => active(c) && c.source === target.source && c.fileName === target.fileName && entity && loanIdentity(c) === entity,
        );
        const choose = (fields: Field[]) => {
          const pool = sameLoan.filter((c) => fields.includes(c.field));
          const nearby = pool.filter((c) => sameRegion(c, target));
          return nearby.length ? nearby : pool;
        };
        spec.groups.principal = choose(['loanPrincipal', 'loanBalance']).map((c) => c.id);
        spec.groups.rate = choose(['loanRate']).map((c) => c.id);
        spec.groups.term = choose(['loanTerm']).map((c) => c.id);
        if (/원리금균등/.test(target.originalText) && !/만기일시|원금균등|아님|아니|미확인/.test(target.originalText))
          spec.loanMethod = '원리금균등';
        if (/거치\s*(?:기간\s*)?(?:없음|0\s*개월)/.test(target.originalText) && !/아님|아니|미확인/.test(target.originalText))
          spec.graceMonths = '0';
        const p = items.find((c) => c.id === spec.groups.principal[0]),
          n = items.find((c) => c.id === spec.groups.term[0]);
        if (spec.groups.principal.length === 1 && spec.groups.term.length === 1 && p && n) {
          if (p.field === 'loanBalance' && /잔여/.test(n.label)) spec.loanBasis = '현재 잔액·잔여 기간';
          else if (p.field === 'loanPrincipal' && /전체|약정/.test(n.label)) spec.loanBasis = '최초 원금·전체 기간';
        }
        if (!entity) missing.push('대출 대상 명칭 확인 필요');
        if (spec.graceMonths === '') missing.push('거치기간 확인 필요');
        if (spec.loanMethod === '미확인') missing.push('상환방식 확인 필요');
        if (spec.loanBasis === '미확인') missing.push('원금·전체 기간 또는 잔액·잔여 기간의 조합 확인 필요');
      }
      for (const group of rules[rule].groups) {
        const selected = spec.groups[group.key] ?? [];
        if (!selected.length) missing.push(`${group.label} 없음`);
        else if (!group.many && selected.length !== 1) missing.push(`${group.label} 후보 ${selected.length}개 · 하나를 선택하세요.`);
      }
      const ids = dedupe([target.id, ...Object.values(spec.groups).flat()]);
      const members = items.filter((c) => ids.includes(c.id));
      if (new Set(members.map((c) => `${c.field}:${c.label}`)).size !== members.length)
        risks.push('같은 명칭의 반복 후보가 있습니다. 같은 항목을 중복 합산하지 마세요.');
      if (members.some((c) => !comparable(c))) missing.push('일부 숫자·단위 미확인');
      risks.push(...contextRisks(members), '자동 구성은 범위 완전성을 보증하지 않습니다.');
      output.push({
        id: `calc:${target.id}`,
        kind: 'CALC',
        title: `${ruleTitles[rule]} · ${target.source} ${region(target)}`,
        candidateIds: ids,
        calculation: spec,
        reason: '같은 자료의 표·시트, 항목 유형과 월·연 구분으로 구성했습니다. 숫자의 일치 여부는 선택 기준이 아닙니다.',
        risks: dedupe(risks),
        missing,
        confidence: missing.length ? '정보 부족' : '구조 일치',
        primary: rule !== 'loan' || missing.length < 3,
        references: [],
        scopeIssues,
      });
    }
  return output;
}
/** 문서 간 반복 후보를 유지하되 대표 후보를 유형·대출 명칭·자료 구조로 우선 표시한다. */
function cross(items: Candidate[], links: Link[], includeIncompatible = false): Recommendation[] {
  const result: Recommendation[] = suggestLinks(items, [], includeIncompatible).flatMap((pair) => {
    const a = items.find((c) => c.id === pair.xlsxId)!,
      b = items.find((c) => c.id === pair.docxId)!;
    if (party(a) && party(b) && party(a) !== party(b)) return [];
    if (a.field.startsWith('loan') && (!loanIdentity(a) || loanIdentity(a) !== loanIdentity(b))) return [];
    const risks = dedupe([...contextRisks([a, b]), pair.reason]);
    if (party(a) !== party(b)) risks.push('명의·소득 대상이 같은지 확인하세요.');
    return [
      {
        id: `cross:${a.id}:${b.id}`,
        kind: 'CROSS' as const,
        title: `${a.label} ↔ ${b.label}`,
        candidateIds: [a.id, b.id],
        link: { xlsxId: a.id, docxId: b.id },
        reason: '항목 유형·명칭·단위가 유사합니다. 값이 달라도 비교 후보를 유지합니다.',
        risks,
        missing: [],
        confidence: '원문 검토 필요' as const,
        primary: false,
        references: [],
      },
    ];
  });
  const score = (r: Recommendation) => {
    const [a, b] = r.candidateIds.map((id) => items.find((c) => c.id === id)!);
    return (
      (monthly(a.period) && monthly(b.period) ? 30 : a.period === b.period ? 15 : 0) +
      (a.confidence === '문맥 일치' ? 5 : 0) +
      (b.confidence === '문맥 일치' ? 5 : 0) +
      (a.asOf && a.asOf === b.asOf ? 5 : 0) +
      (a.scenario && a.scenario === b.scenario ? 5 : 0)
    );
  };
  result.sort((a, b) => score(b) - score(a));
  const seen = new Set<string>(),
    counts = new Map<string, number>();
  for (const r of result) for (const id of r.candidateIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const r of result) {
    const [a, b] = r.candidateIds.map((id) => items.find((c) => c.id === id)!);
    const key = `${a.field}:${a.field.startsWith('loan') ? loanIdentity(a) : ''}`;
    if (coreFields.includes(a.field) && party(a) === party(b) && !seen.has(key)) {
      r.primary = true;
      seen.add(key);
    }
    const repeats = counts.get(r.candidateIds[0])! + counts.get(r.candidateIds[1])! - 1;
    if (repeats > 1) r.risks.push(`반복 연결 후보 ${repeats}개 · 추가 후보에서 원본 위치를 선택할 수 있습니다.`);
    if (links.some((l) => l.xlsxId === r.link!.xlsxId && l.docxId === r.link!.docxId)) r.reason += ' 현재 승인된 연결입니다.';
  }
  return result;
}
function alias(label: string) {
  return label.replace(/\s/g, '').split('·').at(-1) ?? '';
}
/** 명시된 '자산 금액을 목표에 배정' 문장만 가져온다. 관계가 없거나 이름이 모호하면 생성하지 않는다. */
export function allocationRecommendations(items: Candidate[], references: EvidenceRef[]): Recommendation[] {
  const output: Recommendation[] = [];
  for (const ref of references)
    for (const [index, match] of [
      ...ref.originalText.matchAll(
        /([^.;\n|]+?)\s*(\d[\d,]*(?:\.\d+)?)\s*(억\s*원|만\s*원|원)(?:을|를)?\s*([^.;\n|]+?)(?:에|으로)\s*(?:우선\s*)?(?:배정|할당)/g,
      ),
    ].entries()) {
      const from = match[1].trim().replace(/^(?:재원은|자금은)\s*/, ''),
        to = match[4].trim();
      const assets = items.filter(
        (c) =>
          comparable(c) &&
          ['deposit', 'etf', 'pension', 'housingDeposit'].includes(c.field) &&
          alias(c.label).includes(from.replace(/\s/g, '')),
      );
      const goals = items.filter((c) => comparable(c) && c.field === 'goalAmount' && alias(c.label).includes(to.replace(/\s/g, '')));
      if (assets.length !== 1 || goals.length !== 1) continue;
      const unit = unitOf(match[3]);
      if (normalize(match[2], unit) === null) continue;
      const id = `recommended:allocation:${ref.source}:${ref.fileName}:${ref.location}:${index}`;
      const allocation = {
        ...newRecord('allocation', id),
        label: `${from} → ${to}`,
        assetId: assets[0].id,
        goalId: goals[0].id,
        amount: match[2],
        unit,
        references: [ref],
      };
      output.push({
        id,
        kind: 'ALLOC',
        title: allocation.label,
        candidateIds: [assets[0].id, goals[0].id],
        reason: '원문에 배정·할당 관계와 금액이 명시되어 있고 각 명칭의 후보가 하나입니다.',
        risks: ['사용 기간·시나리오·현재 자산/미래 적립금·배정 상태는 사용자 확인이 필요합니다.'],
        missing: ['배정 조건 확인 필요'],
        confidence: '원문 검토 필요',
        primary: true,
        allocation,
        references: [ref],
      });
    }
  return output;
}
/** 모든 추천은 미승인 상태의 구성 정보이며 실제 데이터나 확인 여부를 변경하지 않는다. */
export function recommend(
  items: Candidate[],
  links: Link[],
  planning: Planning,
  references: EvidenceRef[],
  includeIncompatible = false,
): Recommendation[] {
  const output = [...cross(items, links, includeIncompatible), ...calculations(items), ...allocationRecommendations(items, references)];
  for (const row of planning.allocations.filter((r) => !r.excluded))
    output.push({
      id: `allocation:${row.id}`,
      kind: 'ALLOC',
      title: row.label,
      reviewed: row.confirmed,
      candidateIds: dedupe([row.assetId, row.goalId, ...row.candidateIds].filter(Boolean)),
      reason: '등록된 자산·목표 배정의 동시 사용 기간을 검사할 수 있습니다.',
      risks: ['원본과 보유액·목표액·시나리오를 확인하세요.'],
      missing: [],
      confidence: '원문 검토 필요',
      primary: row.confirmed || !!(row.assetId && row.goalId && row.amount && row.start && row.end && row.scenario),
      references: row.references,
      planFocus: { kind: 'allocations', id: row.id },
    });
  for (const row of planning.funds.filter((r) => !r.excluded))
    output.push({
      id: `fund:${row.id}`,
      kind: 'PLAN',
      title: `조건부 금액 · ${row.label}`,
      reviewed: row.confirmed,
      candidateIds: row.candidateIds,
      reason: '지원·기여금·보험금·공제 문맥 또는 직접 입력된 금액입니다.',
      risks: ['지원비 일반 설명일 수 있으므로 원문을 확인하세요.'],
      missing: [
        ...(normalize(row.amount, row.unit) === null ? ['금액·단위 확인 필요'] : []),
        ...(row.approval === '미확인' ? ['승인 여부 확인 필요'] : []),
        ...(row.received === '미확인' ? ['실제 수령 여부 확인 필요'] : []),
        ...(row.destination === '미확인' ? ['반영처 확인 필요'] : []),
        ...(['현재 자산', '확정 수입'].includes(row.destination) &&
        (dateValue(row.reflectedAt) === null || dateValue(planning.asOf) === null)
          ? ['반영일·검토 기준일 확인 필요']
          : []),
        ...(!row.scenario.trim() ? ['시나리오 확인 필요'] : []),
      ],
      confidence: row.approval !== '미확인' && row.received !== '미확인' ? '원문 검토 필요' : '정보 부족',
      primary:
        row.confirmed || (['현재 자산', '확정 수입'].includes(row.destination) && row.approval !== '미확인' && row.received !== '미확인'),
      references: row.references,
      planFocus: { kind: 'funds', id: row.id },
    });
  for (const row of planning.actions.filter((r) => !r.excluded)) {
    const peers = planning.actions.filter(
      (p) =>
        !p.excluded &&
        p.id !== row.id &&
        p.targetId.trim() === row.targetId.trim() &&
        row.targetId.trim() &&
        p.side !== row.side &&
        p.side !== '미확인' &&
        row.side !== '미확인',
    );
    output.push({
      id: `action:${row.id}`,
      kind: 'PLAN',
      title: `계획 행동 · ${row.label}`,
      reviewed: row.confirmed,
      candidateIds: row.candidateIds,
      reason: peers.length
        ? `같은 대상 ID의 상대 행동 ${peers.length}개가 있습니다. 동일 기간·시나리오인지 확인하세요.`
        : '대응 제안·실행이 아직 특정되지 않았습니다. 새 관계를 만들지 않습니다.',
      risks: ['부정·복수 행동 또는 보유/신규 적립의 대상 범위를 확인하세요.'],
      missing: [
        ...(dateValue(row.start) === null || dateValue(row.end) === null ? ['적용 기간 확인 필요'] : []),
        ...(!row.scenario.trim() ? ['시나리오 확인 필요'] : []),
        ...(row.side === '미확인' || row.action === '미확인' ? ['제안/실행·행동 구분 확인 필요'] : []),
        ...(!peers.length ? ['대응 계획 연결 확인 필요'] : []),
      ],
      confidence: peers.length ? '원문 검토 필요' : '정보 부족',
      primary: row.confirmed || peers.some((p) => p.start && p.end && row.start && row.end && p.scenario && p.scenario === row.scenario),
      references: row.references,
      planFocus: { kind: 'actions', id: row.id },
    });
  }
  if (!output.some((r) => r.kind === 'ALLOC'))
    output.push({
      id: 'allocation:missing',
      kind: 'ALLOC',
      title: '자산별 목표 배정 관계 확인',
      candidateIds: [],
      reason: '원문에 명확한 자산→목표 배정 관계가 없거나 후보가 여러 개입니다. 금액·이름이 비슷하다는 이유로 연결하지 않습니다.',
      risks: [],
      missing: ['자산·목표·배정액·기간을 원문에서 확인해 연결하세요.'],
      confidence: '정보 부족',
      primary: false,
      references: [],
    });
  return output.sort((a, b) => Number(b.primary) - Number(a.primary));
}
