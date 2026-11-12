import type { QualityEntry } from '../inspection/quality';
import { contextMismatch, qualityTiers } from '../inspection/quality';
import type { Candidate } from '../normalization/types';
export type Discovery = { representative: QualityEntry; members: QualityEntry[] };
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
const fact = (c: Candidate) => JSON.stringify([c.source, c.fileName, c.field, c.label.trim(), c.normalizedValue, c.unit, condition(c)]);
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
            pair.every((c) => c.field === target.field && condition(c) === condition(target)) &&
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
  return [...groups.values()].map((members) => {
    const sorted = [...members].sort(
      (a, b) =>
        Number(b.finding.approved?.status === '오류') - Number(a.finding.approved?.status === '오류') ||
        qualityTiers.indexOf(a.tier) - qualityTiers.indexOf(b.tier) ||
        entries.indexOf(a) - entries.indexOf(b),
    );
    return { representative: sorted[0], members: sorted };
  });
}
