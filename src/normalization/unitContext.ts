import type { Unit } from './types';
export type UnitEvidence = {
  level: 'cell' | 'column' | 'table' | 'sheet' | 'unknown' | 'conflict';
  locations: string[];
  region: string;
  column: string;
  userOverride?: boolean;
};
export type UnitHint = { units: Unit[]; location: string; level: 'column' | 'table' | 'sheet' };
/** 한 선언 안의 복수 단위를 보존해 충돌을 숨기지 않는다. 날짜의 년은 통화 선언으로 취급하지 않는다. */
export function declaredUnits(text: string): Unit[] {
  const matches = [...text.matchAll(/억\s*원|만\s*원|(?<![만억])원|%|개월/g)].map((m) => m[0].replace(/\s/g, ''));
  return [...new Set(matches.map((s): Unit => (s === '만원' ? '만 원' : s === '억원' ? '억 원' : (s as Unit))))];
}
export const headerName = (s: string) => s.replace(/[（(][^）)]*[）)]/g, '').replace(/\s/g, '');
export const isHeader = (s: string) => /^(항목|구분|내용|금액|월|연|일자|기준일|비고|항목명)$/.test(headerName(s));
export const isDateText = (s: string) => /^\s*\d{4}[-./년]\s*\d{1,2}(?:[-./월]\s*\d{1,2}일?)?\s*$/.test(s);
/** 명시 셀 단위를 우선하고, 상속되는 선언끼리 충돌하면 단위를 비운다. */
export function resolveUnit(explicit: Unit, hints: UnitHint[], region: string, column: string): { unit: Unit; evidence: UnitEvidence } {
  const evidence: UnitEvidence = { level: 'unknown', locations: [], region, column };
  if (explicit !== '미확인') return { unit: explicit, evidence: { ...evidence, level: 'cell' } };
  const active = hints.filter((h) => h.units.length),
    units = [...new Set(active.flatMap((h) => h.units))];
  if (units.length !== 1)
    return {
      unit: '미확인',
      evidence: { ...evidence, level: units.length ? 'conflict' : 'unknown', locations: active.map((h) => h.location) },
    };
  return { unit: units[0], evidence: { ...evidence, level: active.at(-1)!.level, locations: active.map((h) => h.location) } };
}
/** 기간은 숫자값으로 추측하지 않고 명칭·열 제목의 월/연 선언으로만 구분한다. */
export function periodOf(header: string, label: string, flow: boolean) {
  const h = headerName(header);
  if (header.match(/\d{4}/)) return header.match(/\d{4}/)![0];
  if (/^(연|연간|연별)/.test(h) || /[（(]\s*연(?:간)?\s*[）)]/.test(header)) return '연간';
  if (/^(월|월간|매월)/.test(h) || /[（(]\s*월(?:간)?\s*[）)]/.test(header) || (flow && /월|고정지출|변동지출|저축·투자/.test(label)))
    return '월간';
  return h.match(/\d{4}/)?.[0] ?? '';
}
