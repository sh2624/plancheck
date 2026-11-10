import type { Candidate, Link } from './types';
import { compatibleUnit } from './values';
import { assessRelationship } from './relationships';
/** 합계 항목은 유형으로, 세부 항목은 명칭의 공통 어휘로 연결 범위를 좁힌다. */
function similarName(a: Candidate, b: Candidate) {
  if (['income', 'totalAssets', 'totalDebt', 'netAssets', 'surplus', 'deposit', 'etf', 'pension', 'housingDeposit'].includes(a.field))
    return true;
  const tokens = (c: Candidate) =>
    c.label
      .replace(/고정지출|변동지출|저축·투자|금액|가정|확정/g, '')
      .split(/[\s·()[\]/]+/)
      .filter((t) => t.length > 1);
  return tokens(a).some((t) => tokens(b).some((u) => u.includes(t) || t.includes(u)));
}
/** 다른 금액도 연결 후보로 유지한다. 날짜·기간·시나리오 차이는 별도 표시한다. */
export function suggestLinks(items: Candidate[], links: Link[], includeIncompatible = false) {
  const xlsx = items.filter((c) => c.source === 'XLSX' && !c.excluded);
  const docx = items.filter((c) => c.source === 'DOCX' && !c.excluded);
  return xlsx.flatMap((a) =>
    docx
      .filter(
        (b) =>
          a.field === b.field &&
          a.field !== 'unknown' &&
          compatibleUnit(a.field, a.unit) &&
          compatibleUnit(b.field, b.unit) &&
          similarName(a, b) &&
          (includeIncompatible || !assessRelationship(a, b).blocked) &&
          (!/loan/.test(a.field) || (/학자금/.test(a.label) === /학자금/.test(b.label) && /신용/.test(a.label) === /신용/.test(b.label))) &&
          !links.some((l) => l.xlsxId === a.id && l.docxId === b.id),
      )
      .map((b) => ({
        xlsxId: a.id,
        docxId: b.id,
        reason:
          [
            a.asOf && b.asOf && a.asOf !== b.asOf ? '기준일 다름' : '',
            a.period && b.period && a.period !== b.period ? '적용 기간 다름' : '',
            a.scenario && b.scenario && a.scenario !== b.scenario ? '시나리오 다름' : '',
            !a.asOf || !b.asOf ? '기준일 확인 필요' : '',
            !a.scenario || !b.scenario ? '시나리오 확인 필요' : '',
          ]
            .filter(Boolean)
            .join(' · ') || '항목 유형·단위 일치 · 원문 확인 필요',
      })),
  );
}
/** 제외·수정·파일 교체된 항목이 포함된 승인을 제거한다. */
export function removeLinks(links: Link[], ids: Set<string>) {
  return links.filter((l) => !ids.has(l.xlsxId) && !ids.has(l.docxId));
}
