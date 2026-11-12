import { describe, expect, it } from 'vitest';
import { GroundingError, entityTarget, originalAmount, originalSpan } from '../src/ai/provenance';
import { readProposals, type Proposal } from '../src/ai/contract';
import { importProposal } from '../src/ai/import';
import { emptyPlanning } from '../src/planning/types';
import { validatePlanning } from '../src/planning/engine';
const sources = [{ id: 's0', text: '별빛 지원금 173만 원은 미승인 상태다.' }];
const proposal: Proposal = {
  kind: 'conditional_fund',
  certainty: 'unknown',
  uncertainty: '수령·반영 상태 확인 필요',
  evidence: [{ sourceId: 's0', quote: sources[0].text, target: '별빛 지원금', number: '173', unit: '만 원', action: null, timing: null }],
};
describe('AI 출처의 안전한 표기 정규화', () => {
  it.each([
    ['1730000', '원', '173만 원'],
    ['1,730,000', '원', '173만원'],
    ['173', '만원', '1,730,000원'],
    ['0.0173', '억 원', '173만원'],
    ['24', '개월', '2년'],
  ])('동일한 원문 금액·기간만 환산 %s %s', (number, unit, quote) => {
    expect(originalAmount(number, unit, quote)).not.toBeNull();
  });
  it.each([
    ['173', '원', '173만 원'],
    ['174', '만 원', '173만 원'],
    ['173', '%', '173만원'],
    ['73', '만원', '173만원'],
    ['1,73', '원', '173원'],
    ['2', '개월', '2년'],
  ])('다른 값·차원·부분 숫자는 거부 %s %s', (number, unit, quote) => {
    expect(originalAmount(number, unit, quote)).toBeNull();
  });
  it('공백을 제거해도 실제 원문의 연속 구간으로 복원한다', () => {
    expect(originalSpan('제안: 별빛  ETF 월 17만 원 적립 중단.', '별빛 ETF 월17만원')).toBe('별빛  ETF 월 17만 원');
    expect(originalSpan('173만원', '73만원')).toBeNull();
    expect(originalSpan('별빛 예금', '동일 예금')).toBeNull();
  });
  it.each(['원', '만원', '173만 원', '1,730,000', '중단'])('숫자·단위·행동을 대상명으로 받지 않는다: %s', (text) =>
    expect(entityTarget(text)).toBe(false),
  );
  it('대상·금액 환산을 원문 표현으로 복원하고 자동 확인하지 않는다', () => {
    const result = readProposals(
      { proposals: [{ ...proposal, evidence: [{ ...proposal.evidence[0], target: '별빛지원금', number: '1730000', unit: '원' }] }] },
      sources,
    )[0];
    expect(result.evidence[0]).toMatchObject({ target: '별빛 지원금', number: '173', unit: '만 원' });
    const refs = [{ source: 'DOCX' as const, fileName: 'synthetic.docx', location: '문단 1', originalText: sources[0].text }];
    const planning = importProposal(emptyPlanning(), result, refs, 'test');
    expect(planning.funds[0]).toMatchObject({ amount: '173', unit: '만 원', confirmed: false, approval: '미확인' });
    expect(validatePlanning([], planning).every((r) => r.status !== '오류')).toBe(true);
  });
  it('대상 미확인은 null로 남기고 유사명·단위 이름은 승인하지 않는다', () => {
    expect(
      readProposals({ proposals: [{ ...proposal, evidence: [{ ...proposal.evidence[0], target: null }] }] }, sources)[0].evidence[0].target,
    ).toBeNull();
    for (const target of ['원', '173만 원', '다른 지원금'])
      expect(() => readProposals({ proposals: [{ ...proposal, evidence: [{ ...proposal.evidence[0], target }] }] }, sources)).toThrow();
  });
  it('실패 필드는 개인정보 없는 경로·코드로만 보고한다', () => {
    try {
      readProposals({ proposals: [{ ...proposal, evidence: [{ ...proposal.evidence[0], timing: '2039-01-01' }] }] }, sources);
      expect.fail();
    } catch (error) {
      expect(error).toBeInstanceOf(GroundingError);
      expect((error as GroundingError).issue).toEqual({
        path: 'proposals[0].evidence[0].timing',
        code: 'UNSUPPORTED_LITERAL',
        category: 'timing',
      });
      expect(JSON.stringify((error as GroundingError).issue)).not.toMatch(/2039|별빛|173/);
    }
  });
});
