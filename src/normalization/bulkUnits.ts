import type { Candidate, Unit } from './types';
import { compatibleUnit } from './values';
export const unitRangeKey = (c: Candidate) => JSON.stringify([c.source, c.fileName, c.unitEvidence?.region]);
/** 명시적 셀 단위·제외 항목은 보호하고 사용자가 선택한 표/열 안의 호환 항목만 편집한다. */
export function bulkUnitIds(items: Candidate[], key: string, column: string, unit: Unit) {
  return items
    .filter(
      (c) =>
        !c.excluded &&
        c.unitEvidence &&
        c.unitEvidence.level !== 'cell' &&
        unitRangeKey(c) === key &&
        (!column || c.unitEvidence.column === column) &&
        compatibleUnit(c.field, unit),
    )
    .map((c) => c.id);
}
