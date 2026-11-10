import type { Candidate } from '../normalization/types';
import { provisional } from '../validation/discovery';
import { normalize } from '../normalization/values';
import type { EvidenceRef, Result } from '../validation/types';
import type { Allocation, PlanAction, Planning, RecordBase } from './types';
const trim = (s: string) => s.trim();
const money = (value: string, unit: Candidate['unit']) => (['원', '만 원', '억 원'].includes(unit) ? normalize(value, unit) : null);
/** ISO 일자만 유효한 기간 경계로 사용하고 애매한 자연어 기한은 보류한다. */
export function dateValue(text: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const t = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === text ? t : null;
}
function interval(row: { start: string; end: string }): [number, number] | null {
  const start = dateValue(row.start),
    end = dateValue(row.end);
  return start === null || end === null || end < start ? null : [start, end];
}
function evidence(rows: RecordBase[], items: Candidate[]) {
  return items.filter((c) => rows.some((r) => r.candidateIds.includes(c.id)));
}
function references(rows: RecordBase[]): EvidenceRef[] {
  return rows.flatMap((r) => r.references);
}
function result(id: string, code: string, title: string, rows: RecordBase[], items: Candidate[]): Result {
  return {
    id,
    code,
    title,
    status: '검증 불가',
    evidence: evidence(rows, items),
    references: references(rows),
    actual: null,
    expected: null,
    difference: null,
    unit: code === 'PLAN_CONFLICT' ? '' : '원',
    basis: '사용자가 확인한 구조화 항목에 한정한 검증.',
    needs: [],
  };
}
function recordIssues(rows: RecordBase[], items: Candidate[], discovery = false): string[] {
  return rows.flatMap((r) => [
    ...(!discovery && !r.confirmed ? [`${r.label}: 사용자 확인 필요`] : []),
    ...(!r.label.trim() ? [`${r.id}: 항목명 필요`] : []),
    ...r.candidateIds.flatMap((id) => {
      const c = items.find((c) => c.id === id);
      return !c || c.excluded || (!discovery && !c.confirmed) ? [`${r.label}: 연결 원본 항목 누락·제외·미확인`] : [];
    }),
    ...(!r.references.length && !r.candidateIds.length ? [`${r.label}: 원본 위치·문맥 연결 필요`] : []),
    ...(r.references.some((ref) => !ref.fileName.trim() || !ref.location.trim() || !ref.originalText.trim())
      ? [`${r.label}: 원본 근거 불완전`]
      : []),
  ]);
}
function candidateIssues(c: Candidate | undefined, name: string, discovery = false): string[] {
  if (!c) return [`${name} 항목을 연결하세요.`];
  return [
    ...((!discovery && !c.confirmed) || c.excluded ? [`${name}: 원본 확인 또는 제외 해제 필요`] : []),
    ...(money(c.number, c.unit) === null || money(c.number, c.unit) !== c.normalizedValue
      ? [`${name}: 유효한 금액과 원 단위 정규화 필요`]
      : []),
  ];
}
function sumAmounts(rows: Allocation[]): number | null {
  let total = 0;
  for (const row of rows) {
    const n = money(row.amount, row.unit);
    if (n === null || n < 0) return null;
    total += n;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}
/** 동일 자산·동일 시나리오의 시간 구간별 동시 배정 최대값을 검사한다. 미래 적립금은 별도 보류한다. */
function evaluateAllocations(items: Candidate[], allocations: Allocation[], discovery = false): Result[] {
  const active = allocations.filter((r) => !r.excluded),
    out: Result[] = [];
  const groups = new Map<string, Allocation[]>();
  for (const row of active) {
    const key = JSON.stringify([row.assetId, trim(row.scenario), row.funding]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const [key, rows] of groups) {
    const base = result(`alloc:${key}`, 'ALLOC_CAPACITY', `동시 자금 배정 · ${rows[0].label}`, rows, items);
    const asset = items.find((c) => c.id === rows[0].assetId);
    const goals = rows.map((r) => items.find((c) => c.id === r.goalId));
    const usedIds = new Set([asset?.id, ...goals.map((g) => g?.id)]);
    base.evidence = [...base.evidence, ...items.filter((c) => usedIds.has(c.id) && !base.evidence.some((e) => e.id === c.id))];
    const unavailable = [
      ...candidateIssues(asset, '보유 자산', discovery),
      ...goals.flatMap((g) => candidateIssues(g, '목표액', discovery)),
      ...recordIssues(
        rows.map((r) => ({
          ...r,
          candidateIds: [...r.candidateIds, ...(asset ? [asset.id] : []), ...goals.filter((g): g is Candidate => !!g).map((g) => g.id)],
        })),
        items,
        discovery,
      ).filter((x) => !x.includes('원본 위치·문맥 연결 필요')),
    ];
    if (asset && !['deposit', 'etf', 'pension', 'housingDeposit'].includes(asset.field)) unavailable.push('보유 자산 유형을 선택하세요.');
    if (goals.some((g) => g && g.field !== 'goalAmount')) unavailable.push('금액이 있는 재무목표(목표액 유형)를 연결하세요.');
    if (rows.some((r) => money(r.amount, r.unit) === null || money(r.amount, r.unit)! < 0))
      unavailable.push('배정액은 0 이상의 원·만 원·억 원 금액이어야 합니다.');
    if (unavailable.length) {
      out.push({ ...base, needs: [...new Set(unavailable)] });
      continue;
    }
    const needs: string[] = [];
    if (!asset!.asOf.trim() || asset!.certainty !== '확정' || goals.some((g) => g!.certainty !== '확정'))
      needs.push('자산 기준일·자산 및 목표액의 확정 상태 확인 필요');
    if (!trim(rows[0].scenario) || !trim(asset!.scenario) || rows[0].scenario.trim() !== asset!.scenario.trim())
      needs.push('자산과 배정의 시나리오 확인 필요 (대체 시나리오별로 따로 검사합니다).');
    if (goals.some((g) => !g!.scenario.trim() || g!.scenario.trim() !== rows[0].scenario.trim()))
      needs.push('목표와 배정의 시나리오 확인 필요');
    if (rows.some((r) => r.certainty !== '확정' || r.funding === '미확인')) needs.push('배정 상태 및 현재 자산/미래 적립금 구분 확인 필요');
    if (rows.some((r) => r.funding === '미래 적립금'))
      needs.push('미래 적립금은 현재 보유액의 중복 배정에 포함하지 않습니다. 적립 시점·수령액을 별도로 확인하세요.');
    if (rows.some((r) => !interval(r))) needs.push('사용 시작·종료일을 유효한 ISO 일자로 확인하세요.');
    const assetDate = dateValue(asset!.asOf);
    if (assetDate === null || rows.some((r) => interval(r) && interval(r)![0] < assetDate!))
      needs.push('보유액 기준일과 사용 기간의 선후 관계 확인 필요');
    const periods = rows.map(interval);
    let max = 0,
      peakRows: Allocation[] = [];
    if (periods.every((p) => p !== null) && !rows.some((r) => r.funding !== '현재 자산')) {
      for (const [point] of periods as [number, number][]) {
        const simultaneous = rows.filter((_, i) => periods[i]![0] <= point && point <= periods[i]![1]);
        const total = sumAmounts(simultaneous);
        if (total === null) {
          needs.push('배정 합계가 안전한 숫자 범위를 초과합니다.');
          break;
        }
        if (total > max) {
          max = total;
          peakRows = simultaneous;
        }
      }
    }
    const available = asset!.normalizedValue!;
    if (available < 0) needs.push('사용 가능한 보유액이 음수입니다.');
    const details = rows
      .map(
        (r, i) =>
          `${r.label}: 자산=${asset!.label}(${asset!.id}, ${available}원), 목표=${goals[i]!.label}(${goals[i]!.normalizedValue}원), 배정=${money(r.amount, r.unit)}원, ${r.start}~${r.end}, ${r.funding}, ${r.certainty}, 시나리오=${r.scenario}`,
      )
      .join('\n');
    const basis = `${details}\n동시 배정 최대액=${max}원, 사용 가능 보유액=${available}원. 사용 기간은 양 끝 날짜를 포함합니다. 최대 동시 항목: ${peakRows.map((r) => r.label).join(', ')}. 순차 사용의 원금 소진·미래 잔액 자체는 검사하지 않습니다.`;
    out.push({
      ...base,
      status: needs.length ? '확인 필요' : max > available ? '오류' : '검증 통과',
      actual: needs.length ? null : max,
      expected: available,
      difference: needs.length ? null : max - available,
      basis,
      needs,
    });
  }
  return out;
}
/** 미승인·미수령인 가정/조건부 금액의 현재 확정 반영을 검사한다. 예상 시나리오는 분리한다. */
function evaluateConditionalFunds(items: Candidate[], state: Planning, discovery = false): Result[] {
  return state.funds
    .filter((r) => !r.excluded)
    .map((row) => {
      const base = result(`fund:${row.id}`, 'PLAN_CONDITIONAL', `조건부 금액 · ${row.label}`, [row], items),
        amount = money(row.amount, row.unit);
      const unavailable = recordIssues([row], items, discovery);
      if (amount === null || amount < 0) unavailable.push('0 이상의 금액·단위를 확인하세요.');
      if (unavailable.length) return { ...base, needs: unavailable };
      const basis = `금액=${amount}원, 상태=${row.certainty}, 승인=${row.approval}, 수령=${row.received}, 반영처=${row.destination}, 반영일=${row.reflectedAt || '미확인'}, 검토 기준일=${state.asOf || '미확인'}, 시나리오=${row.scenario || '미확인'}.`;
      const next = { ...base, actual: amount, basis };
      if (!row.scenario.trim())
        return {
          ...next,
          status: '확인 필요' as const,
          needs: ['시나리오를 확인하세요.'],
        };
      if (row.approval === '미확인' || row.received === '미확인')
        return {
          ...next,
          status: '확인 필요' as const,
          needs: ['승인·수령 여부가 미확인입니다. 예상 시나리오라도 먼저 해당 상태를 확인하세요.'],
        };
      if (row.destination === '예상 시나리오' || row.destination === '미반영')
        return {
          ...next,
          status: '검증 통과' as const,
          needs: [],
          basis: `${basis} 현재 확정 자산·수입에 포함되지 않은 별도 예상/참고 항목입니다.`,
        };
      if (amount === 0)
        return {
          ...next,
          status: '확인 필요' as const,
          needs: ['0원이 실제 반영액인지 미확인 자리표시자인지 확인하세요.'],
        };
      const asOf = dateValue(state.asOf),
        at = dateValue(row.reflectedAt);
      if (row.destination === '미확인' || asOf === null || at === null || at > asOf)
        return {
          ...next,
          status: '확인 필요' as const,
          needs: ['현재 자산/확정 수입 반영 여부와 반영일·검토 기준일을 확인하세요.'],
        };
      if (['가정', '조건부'].includes(row.certainty) && row.approval === '미승인' && row.received === '미수령')
        return {
          ...next,
          status: '오류' as const,
          basis: `${basis} 미승인·미수령 조건부/가정 금액을 현재 확정 금액에 반영했습니다.`,
        };
      if (row.certainty === '확정' && (row.received === '수령' || (row.approval === '승인' && row.destination === '확정 수입')))
        return {
          ...next,
          status: '검증 통과' as const,
          basis: `${basis} 이 규칙에서 검사하는 미확정 금액의 선반영은 확인되지 않았습니다. 회계상 인식 시점의 적정성은 별도 확인 대상입니다.`,
        };
      return {
        ...next,
        status: '확인 필요' as const,
        needs: ['확정 상태·승인·수령의 미확인 또는 상충된 정보를 확인하세요. 승인 후 미수령 금액은 가용 현금으로 단정하지 않습니다.'],
      };
    });
}
const opposite = (a: PlanAction['action'], b: PlanAction['action']) =>
  (a === '중단' && ['유지', '시작', '증액'].includes(b)) ||
  (b === '중단' && ['유지', '시작', '증액'].includes(a)) ||
  (a === '증액' && b === '감액') ||
  (a === '감액' && b === '증액');
/** 같은 대상 ID의 제안·실행만 비교한다. 행동의 부정·대상 동일성은 사용자가 확인한다. */
function evaluateActions(items: Candidate[], actions: PlanAction[], discovery = false): Result[] {
  const active = actions.filter((r) => !r.excluded),
    output: Result[] = [];
  const paired = new Set<string>();
  for (const a of active.filter((r) => r.side === '제안'))
    for (const b of active.filter((r) => r.side === '실행' && trim(r.targetId) === trim(a.targetId) && trim(r.targetId))) {
      paired.add(a.id);
      paired.add(b.id);
      const base = result(`actions:${a.id}:${b.id}`, 'PLAN_CONFLICT', `제안·실행 비교 · ${a.targetId}`, [a, b], items),
        invalid = recordIssues([a, b], items, discovery);
      if (invalid.length) {
        output.push({ ...base, needs: invalid });
        continue;
      }
      const x = interval(a),
        y = interval(b),
        needs: string[] = [];
      if (!x || !y) needs.push('제안과 실행의 시작·종료일을 확인하세요.');
      if (!trim(a.scenario) || !trim(b.scenario) || trim(a.scenario) !== trim(b.scenario))
        needs.push('서로 다른 또는 미확인 시나리오입니다. 동일 계획으로 단정하지 않습니다.');
      if (a.action === '미확인' || b.action === '미확인') needs.push('제안·실행 행동을 확인하세요.');
      if ([a, b].some((r) => r.amount.trim() && (money(r.amount, r.unit) === null || money(r.amount, r.unit)! < 0)))
        needs.push('기재된 행동 금액·단위를 확인하세요.');
      if (opposite(a.action, b.action) && [a, b].some((r) => r.action !== '중단' && r.amount.trim() && money(r.amount, r.unit) === 0))
        needs.push('0원 행동이므로 중단과 현금흐름이 실제로 충돌하는지 확인하세요.');
      const basis = `대상=${a.targetId}. 제안 ${a.action}(${a.start}~${a.end}, ${a.scenario}, ${a.amount || '금액 미기재'} ${a.unit}) / 실행 ${b.action}(${b.start}~${b.end}, ${b.scenario}, ${b.amount || '금액 미기재'} ${b.unit}). 양 끝 날짜를 포함한 동일 대상·겹치는 기간에 한정합니다.`;
      if (needs.length) {
        output.push({ ...base, status: '확인 필요', basis, needs });
        continue;
      }
      if (x![1] < y![0] || y![1] < x![0]) {
        output.push({
          ...base,
          status: '검증 통과',
          basis: `${basis} 적용 기간이 겹치지 않습니다.`,
        });
        continue;
      }
      if (opposite(a.action, b.action)) {
        output.push({
          ...base,
          status: '오류',
          basis: `${basis} 중단과 유지/시작/증액 또는 증액과 감액 행동이 충돌합니다.`,
        });
        continue;
      }
      if (a.action !== b.action) {
        output.push({
          ...base,
          status: '확인 필요',
          basis,
          needs: ['행동 조합의 일관성을 규칙으로 확정할 수 없습니다. (중단과 감액 등)'],
        });
        continue;
      }
      if (a.amount.trim() || b.amount.trim()) {
        const aa = money(a.amount, a.unit),
          bb = money(b.amount, b.unit);
        if (aa === null || bb === null || aa !== bb) {
          output.push({
            ...base,
            status: '확인 필요',
            basis,
            needs: ['행동 금액의 단위·적용 주기·차이를 확인하세요.'],
          });
          continue;
        }
      }
      output.push({
        ...base,
        status: '검증 통과',
        basis: `${basis} 비교한 행동이 일치합니다. 다른 계획의 모순까지 검사한 것은 아닙니다.`,
      });
    }
  for (const row of active.filter((r) => !paired.has(r.id)))
    output.push({
      ...result(`action:${row.id}`, 'PLAN_CONFLICT', `대응 계획 필요 · ${row.label}`, [row], items),
      needs: [...recordIssues([row], items, discovery), '동일 대상 ID의 제안·실행 상대 항목을 연결하고 행동·기간·시나리오를 확인하세요.'],
    });
  return output;
}
/** 승인된 구조화 자금 배정만 검사한다. */
export function validateAllocations(items: Candidate[], rows: Allocation[]): Result[] {
  return evaluateAllocations(items, rows);
}
/** 승인된 조건부 금액만 검사한다. */
export function validateConditionalFunds(items: Candidate[], state: Planning): Result[] {
  return evaluateConditionalFunds(items, state);
}
/** 승인된 제안·실행만 검사한다. */
export function validateActions(items: Candidate[], rows: PlanAction[]): Result[] {
  return evaluateActions(items, rows);
}
/** 명시적으로 연결된 계획을 참고 분석하며 확인 여부·시점·관계를 채우지 않는다. */
export function discoverPlanning(items: Candidate[], state: Planning): Result[] {
  return [
    ...evaluateAllocations(items, state.allocations, true),
    ...evaluateConditionalFunds(items, state, true),
    ...evaluateActions(items, state.actions, true),
  ].map(provisional);
}
/** 기존 CALC·CROSS와 독립적인 자금 배정·계획 검증 진입점. */
export function validatePlanning(items: Candidate[], state: Planning): Result[] {
  return [
    ...validateAllocations(items, state.allocations),
    ...validateConditionalFunds(items, state),
    ...validateActions(items, state.actions),
  ];
}
