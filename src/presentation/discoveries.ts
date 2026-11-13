import type { QualityEntry } from '../inspection/quality';
import { contextMismatch, qualityTiers } from '../inspection/quality';
import type { Candidate } from '../normalization/types';
export type Discovery = { representative: QualityEntry; members: QualityEntry[]; explanation?: string };
const period = (value: string) =>
  ['월', '월간', '매월'].includes(value.trim()) ? '월간' : ['연', '연간', '매년'].includes(value.trim()) ? '연간' : value.trim();
const condition = (c: Candidate) => JSON.stringify([c.asOf.trim(), period(c.period), c.scenario.trim(), c.certainty]);
const origin = (c: Candidate) =>
  JSON.stringify([
    c.source,
    c.fileName,
    c.location,
    c.field,
    c.originalText,
    c.originalNumber,
    c.normalizedValue,
    c.unit,
    condition(c),
    c.method === '직접 입력' ? c.id : '',
  ]);
const aggregateName = (c: Candidate) => {
  const name = c.label.replace(/[\s·ㆍ/]/g, '');
  const aliases: Partial<Record<Candidate['field'], RegExp>> = {
    totalAssets: /^(?:자산)?(?:총자산(?:합계|총계)?|자산합계|자산총계)$/,
    totalDebt: /^(?:부채)?(?:총부채(?:합계|총계)?|부채합계|부채총계)$/,
    netAssets: /^(?:순자산)?순자산(?:합계|총계)?$/,
    surplus: /^(?:잉여자금)?(?:월|월간|연|연간)?(?:순현금흐름|잉여금)(?:합계)?$/,
  };
  return aliases[c.field]?.test(name) ? c.field : c.label.trim();
};
const fact = (c: Candidate) => JSON.stringify([c.source, c.fileName, c.field, aggregateName(c), c.normalizedValue, c.unit, condition(c)]);
const eligible = (e: QualityEntry) =>
  !e.finding.relationship?.blocked &&
  !contextMismatch(e.finding) &&
  !['different', 'unknown'].includes(e.finding.decision?.choice ?? '') &&
  e.finding.signal === '수치 차이' &&
  e.finding.result.actual !== null &&
  e.finding.result.expected !== null &&
  e.finding.result.evidence.every((c) => c.normalizedValue !== null);
/** 같은 원본·값·조건의 검사만 대표로 묶고 개별 규칙과 판단은 members에 보존한다. */
export function groupDiscoveries(entries: QualityEntry[]): Discovery[] {
  const groups = new Map<string, QualityEntry[]>(),
    keys = new Map<QualityEntry, string>();
  for (const entry of entries) {
    const f = entry.finding,
      r = f.result;
    const key =
      f.kind === 'CROSS' && eligible(entry) && r.evidence.length === 2
        ? JSON.stringify(['cross', r.evidence.map(origin).sort(), r.unit, Math.abs(r.difference ?? 0)])
        : `record:${entries.indexOf(entry)}`;
    keys.set(entry, key);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  // 공통 원본을 가진 동일 사실만 묶고 각 위치의 근거는 남긴다.
  for (const [key, members] of [...groups.entries()]) {
    if (!key.startsWith('["cross"') || !groups.has(key)) continue;
    for (const [otherKey, others] of [...groups.entries()]) {
      if (otherKey === key || !otherKey.startsWith('["cross"')) continue;
      const records = [...members, ...others],
        first = records[0].finding.result;
      const sameFacts = records.every(
        (e) =>
          e.finding.result.unit === first.unit &&
          JSON.stringify(e.finding.result.evidence.map(fact).sort()) === JSON.stringify(first.evidence.map(fact).sort()),
      );
      const sharedOrigin = first.evidence.some((c) => records.every((e) => e.finding.result.evidence.some((v) => origin(v) === origin(c))));
      if (!sameFacts || !sharedOrigin) continue;
      members.push(...others);
      for (const e of others) keys.set(e, key);
      groups.delete(otherKey);
    }
  }
  for (const entry of entries) {
    const f = entry.finding,
      r = f.result,
      target = r.evidence[0];
    if (f.kind !== 'CALC' || !eligible(entry) || !target || !r.evidence.every((c) => condition(c) === condition(target))) continue;
    const anchors = [...groups.entries()].filter(
      ([key, members]) =>
        key.startsWith('["cross"') &&
        members.some((e) => {
          const pair = e.finding.result.evidence;
          return (
            e.finding.result.unit === r.unit &&
            r.actual === target.normalizedValue &&
            pair.every((c) => c.field === target.field) &&
            pair.some((c) => origin(c) === origin(target)) &&
            pair.some((c) => origin(c) !== origin(target) && c.normalizedValue === r.expected)
          );
        }),
    );
    // 여러 원본 쌍이 가능한 계산은 임의의 하나에 연결하지 않는다.
    if (anchors.length !== 1) continue;
    const own = keys.get(entry)!;
    groups.delete(own);
    anchors[0][1].push(entry);
  }
  const explanations = new Map<string, string>();
  // 실제 순자산 산식과 동일 원본의 부채 비교가 모두 있을 때만 자산 차이의 파생 기록으로 묶는다.
  for (const [key, members] of [...groups.entries()]) {
    if (!groups.has(key)) continue;
    const netPairs = members.filter(
      (e) => e.finding.kind === 'CROSS' && eligible(e) && e.finding.result.evidence.every((c) => c.field === 'netAssets'),
    );
    if (!netPairs.length) continue;
    const anchors = [...groups.entries()].filter(
      ([otherKey, assets]) => otherKey !== key && netPairs.some((net) => assets.some((asset) => derivedNet(net, asset, entries))),
    );
    if (anchors.length !== 1) continue;
    anchors[0][1].push(...members);
    groups.delete(key);
    explanations.set(
      anchors[0][0],
      '총부채의 문서 간 수치 일치와 각 문서의 순자산 = 총자산 − 총부채 산식으로 연결된 파생 기록입니다. 총자산 차이와 순자산 차이를 함께 보존합니다. 비교 기준의 최종 승인을 뜻하지 않습니다.',
    );
  }
  return [...groups.entries()].map(([key, members]) => {
    const sorted = [...members].sort(
      (a, b) =>
        Number(b.finding.approved?.status === '오류') - Number(a.finding.approved?.status === '오류') ||
        qualityTiers.indexOf(a.tier) - qualityTiers.indexOf(b.tier) ||
        entries.indexOf(a) - entries.indexOf(b),
    );
    return { representative: sorted[0], members: sorted, explanation: explanations.get(key) };
  });
}
/** 같은 차이 금액이 아니라 원본 ID로 연결된 두 산식과 부채 일치 기록으로 인과 관계를 확인한다. */
function derivedNet(net: QualityEntry, asset: QualityEntry, entries: QualityEntry[]) {
  const n = net.finding,
    a = asset.finding;
  if (
    a.kind !== 'CROSS' ||
    !eligible(asset) ||
    a.result.evidence.length !== 2 ||
    !a.result.evidence.every((c) => c.field === 'totalAssets') ||
    n.result.evidence.length !== 2 ||
    n.result.difference !== a.result.difference
  )
    return false;
  const debts: Candidate[] = [];
  for (const target of n.result.evidence) {
    const total = a.result.evidence.find((c) => c.source === target.source && c.fileName === target.fileName);
    if (!total || condition(total) !== condition(target)) return false;
    const proofs = entries.filter((e) => {
      const f = e.finding,
        r = f.result,
        spec = f.recommendation?.calculation;
      return (
        f.kind === 'CALC' &&
        r.code === 'CALC_NET' &&
        r.difference === 0 &&
        r.actual === target.normalizedValue &&
        spec?.targetId === target.id &&
        spec.groups.assets.length === 1 &&
        spec.groups.assets[0] === total.id &&
        spec.groups.debt.length === 1 &&
        !f.recommendation?.scopeIssues?.length &&
        !['different', 'unknown'].includes(f.decision?.choice ?? '') &&
        r.evidence.every((c) => c.source === target.source && c.fileName === target.fileName && condition(c) === condition(target))
      );
    });
    if (proofs.length !== 1) return false;
    const debt = proofs[0].finding.result.evidence.find((c) => c.id === proofs[0].finding.recommendation!.calculation!.groups.debt[0]);
    if (!debt || debt.field !== 'totalDebt' || debt.normalizedValue === null) return false;
    if (target.normalizedValue !== total.normalizedValue! - debt.normalizedValue) return false;
    debts.push(debt);
  }
  return (
    debts[0].normalizedValue === debts[1].normalizedValue &&
    entries.some(
      (e) =>
        e.finding.kind === 'CROSS' &&
        e.finding.result.difference === 0 &&
        !contextMismatch(e.finding) &&
        !e.finding.relationship?.blocked &&
        !['different', 'unknown'].includes(e.finding.decision?.choice ?? '') &&
        e.finding.result.evidence.length === 2 &&
        debts.every((d) => e.finding.result.evidence.some((c) => origin(c) === origin(d))),
    )
  );
}
