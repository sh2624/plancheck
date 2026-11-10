import { it, expect } from 'vitest';
import { groupFindings, findingSection, resultSections, type ReviewedFinding } from '../src/presentation/findingGroups';
import { item } from './validation-fixtures';
import { discoverCross, validateCross } from '../src/validation/engine';
function finding(id: string, x = 'x', d = 'd'): ReviewedFinding {
  const result = discoverCross([item(x, 'income', 10), item(d, 'income', 20, { source: 'DOCX' })], [{ id, xlsxId: x, docxId: d }])[0];
  return {
    id,
    kind: 'CROSS',
    title: '소득 비교',
    signal: '수치 차이',
    result,
    primary: true,
    questions: ['동일 기준인가요?'],
  };
}
it('공유 원본을 사용하는 연결은 전이적으로 묶되 모든 다른 근거를 유지한다', () => {
  const findings = [finding('a', 'x', 'd1'), finding('b', 'x', 'd2'), finding('c', 'x2', 'd2')],
    before = JSON.stringify(findings),
    groups = groupFindings(findings);
  expect(groups[1].groups).toHaveLength(1);
  expect(groups[1].groups[0].map((f) => f.id)).toEqual(['a', 'b', 'c']);
  expect(groups.flatMap((s) => s.groups.flat())).toHaveLength(3);
  expect(JSON.stringify(findings)).toBe(before);
});
it('네 영역을 구분하고 자동 수치 일치나 다른 조건을 통과로 바꾸지 않는다', () => {
  const base = finding('a'),
    error = {
      ...base,
      id: 'error',
      approved: { ...base.result, status: '오류' as const },
    },
    passResult = validateCross(
      [item('x', 'income', 10), item('d', 'income', 10, { source: 'DOCX' })],
      [{ id: 'p', xlsxId: 'x', docxId: 'd' }],
    )[0],
    pass = { ...base, id: 'pass', approved: passResult },
    deferred = {
      ...base,
      id: 'unknown',
      decision: {
        choice: 'unknown' as const,
        candidateIds: ['x', 'd'],
        fingerprint: 'memory',
      },
    },
    same = { ...base, id: 'same', signal: '수치 일치' as const };
  expect(findingSection(error)).toBe(resultSections[0]);
  expect(findingSection(same)).toBe(resultSections[1]);
  expect(findingSection(pass)).toBe(resultSections[2]);
  expect(findingSection(deferred)).toBe(resultSections[3]);
  expect(groupFindings([error, base, pass, deferred, same]).map((s) => s.count)).toEqual([1, 2, 1, 1]);
  expect(deferred.result.difference).toBe(-10);
});
