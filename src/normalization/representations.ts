import type { Candidate } from './types';
import { normalize } from './values';
/** 같은 행·항목·기간·금액 역할의 명시적 단위 변환 열만 묶는다. 원본 후보는 삭제하지 않는다. */
export function markRepresentations(items: Candidate[]): Candidate[] {
  const groups = new Map<string, Candidate[]>();
  for (const c of items) {
    if (c.source !== 'XLSX' || !['원', '만 원', '억 원'].includes(c.unit) || !/^(금액|잔액|보유액|평가액)$/.test(c.valueRole ?? ''))
      continue;
    const key = JSON.stringify([
      c.fileName,
      c.location.replace(/![A-Z]+(\d+)$/, '!$1'),
      c.label,
      c.field,
      c.valueRole,
      c.asOf,
      c.period,
      c.scenario,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const marked = new Map<string, Candidate['representation']>();
  for (const [key, group] of groups)
    if (group.length > 1 && new Set(group.map((c) => c.unit)).size > 1)
      for (const c of group) marked.set(c.id, { key, memberIds: group.map((c) => c.id) });
  return items.map((c) => {
    const representation = marked.get(c.id);
    if (!representation) return c;
    const peers = items.filter((p) => representation.memberIds.includes(p.id));
    const conflict = peers.some((p) => p.normalizedValue === null || p.normalizedValue !== c.normalizedValue);
    return {
      ...c,
      representation,
      ...(conflict
        ? {
            confidence: '확인 필요' as const,
            note: `${c.note} 동일 행 단위별 금액 불일치: ${peers.map((p) => `${p.location} ${p.number}${p.unit}`).join(' / ')}`.trim(),
          }
        : {}),
    };
  });
}
/** 편집 후에도 값·조건을 다시 대조하고 서로 다른 환산값은 대표를 선택하지 않는다. */
export function representationSelection(items: Candidate[]) {
  const output: Candidate[] = [],
    notes: string[] = [],
    conflicts: Candidate[] = [];
  const seen = new Set<string>();
  for (const c of items) {
    const r = c.representation;
    if (!r) {
      output.push(c);
      continue;
    }
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    const peers = items.filter((p) => p.representation?.key === r.key);
    if (peers.length < 2) {
      output.push(c);
      continue;
    }
    const consistent = peers.every(
      (p) =>
        p.normalizedValue !== null &&
        normalize(p.number, p.unit) === p.normalizedValue &&
        p.normalizedValue === c.normalizedValue &&
        p.field === c.field &&
        p.label === c.label &&
        p.period === c.period &&
        p.asOf === c.asOf &&
        p.scenario === c.scenario &&
        p.certainty === c.certainty &&
        p.valueRole === c.valueRole,
    );
    const details = peers.map((p) => `${p.location}: ${p.number}${p.unit} (${p.normalizedValue ?? '미확인'}원)`).join(' / ');
    if (consistent) {
      output.push(c);
      notes.push(`동등한 단위 표현은 ${c.location} 한 번만 계산: ${details}`);
    } else {
      conflicts.push(...peers);
      notes.push(`단위별 금액·조건 불일치로 대표 선택 보류: ${details}`);
    }
  }
  return { items: output, notes, conflicts };
}
