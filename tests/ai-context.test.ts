// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { analyzeContext } from '../server/analyzeContext';
import { readProposals, readRequest, type Proposal } from '../src/ai/contract';
import { importProposal } from '../src/ai/import';
import { emptyPlanning } from '../src/planning/types';
const sources = [{ id: 's0', text: '가상 ETF 월 17만 원 자동이체 중단' }];
const proposal: Proposal = {
  kind: 'action_conflict',
  certainty: 'unknown',
  uncertainty: '동일 기간과 대상 확인 필요',
  evidence: [{ sourceId: 's0', quote: sources[0].text, target: '가상 ETF', number: '17', unit: '만 원', action: '중단', timing: null }],
};
const env = { VERCEL_ENV: 'preview', PLANCHECK_AI_ENABLED: 'true', OPENAI_API_KEY: 'test-secret-not-real', OPENAI_MODEL: 'gpt-4o-mini' };
const request = (body: unknown = { consent: true, sources }) =>
  new Request('https://preview.test/api/analyze-context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const upstream = (data: unknown) => vi.fn<typeof fetch>().mockResolvedValue(Response.json(data));
const complete = (p: unknown = proposal) => ({
  status: 'completed',
  output: [{ content: [{ type: 'output_text', text: JSON.stringify({ proposals: [p] }) }] }],
  usage: { input_tokens: 100, output_tokens: 200 },
});
describe('AI 문맥 실험 안전장치', () => {
  it.each([{}, { ...env, VERCEL_ENV: 'production' }, { ...env, OPENAI_API_KEY: undefined }, { ...env, PLANCHECK_AI_ENABLED: 'false' }])(
    '비활성·운영·키 없는 환경에서 외부 호출 없음',
    async (config) => {
      const fetcher = upstream(complete());
      expect((await analyzeContext(request(), config, fetcher)).status).toBe(503);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it('동의·출처·개수·추가 필드 제한', () => {
    expect(() => readRequest({ consent: false, sources })).toThrow();
    expect(() => readRequest({ consent: true, sources, fileName: 'private' })).toThrow();
    expect(() => readRequest({ consent: true, sources: [...sources, ...sources] })).toThrow();
    expect(() => readRequest({ consent: true, sources: [{ id: 's0', text: 'a'.repeat(1201) }] })).toThrow();
  });
  it.each([
    { sourceId: 's99' },
    { quote: '존재하지 않는 문장' },
    { target: '다른 ETF' },
    { number: '7' },
    { number: '170' },
    { unit: '원화' },
    { timing: '2026-11-12' },
    { action: '유지' },
  ])('원문에 없는 출처·값·조건 거부 %j', (edit) => {
    expect(() => readProposals({ proposals: [{ ...proposal, evidence: [{ ...proposal.evidence[0], ...edit }] }] }, sources)).toThrow();
  });
  it('중단하지 않는다를 중단으로 채택하지 않음', () => {
    const text = 'ETF 자동이체 중단하지 않는다';
    expect(() =>
      readProposals(
        { proposals: [{ ...proposal, evidence: [{ ...proposal.evidence[0], quote: text, target: 'ETF', number: null, unit: null }] }] },
        [{ id: 's0', text }],
      ),
    ).toThrow();
  });
  it('상류 요청은 엄격 스키마·저장 해제·제한된 토큰·타임아웃 사용', async () => {
    const fetcher = upstream(complete());
    const result = await analyzeContext(request(), env, fetcher);
    expect(result.status).toBe(200);
    const data = await result.json();
    expect(data.proposals).toEqual([proposal]);
    expect(data.metrics.estimatedUsd).toBeCloseTo(0.000135, 8);
    const options = fetcher.mock.calls[0][1]!;
    const body = JSON.parse(options.body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body).not.toHaveProperty('reasoning');
    expect(body.store).toBe(false);
    expect(body.max_output_tokens).toBe(1600);
    expect(body.text.format.strict).toBe(true);
    expect(options.signal).toBeTruthy();
    expect(JSON.stringify(data)).not.toContain(env.OPENAI_API_KEY);
  });
  it.each([
    { status: 'incomplete', output: [] },
    { status: 'completed', output: [{ content: [{ type: 'refusal' }] }] },
    complete({ ...proposal, evidence: [] }),
  ])('불완전·거부·검증 실패는 결과로 사용하지 않음', async (output) => {
    const result = await analyzeContext(request(), env, upstream(output));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(await result.json())).not.toContain(sources[0].text);
  });
  it('상류 실패 및 타임아웃에 비밀정보 없이 실패', async () => {
    for (const fetcher of [
      vi.fn<typeof fetch>().mockRejectedValue(new Error('test-secret-not-real')),
      vi.fn<typeof fetch>().mockResolvedValue(new Response('private raw document', { status: 429 })),
    ]) {
      const result = await analyzeContext(request(), env, fetcher);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(await result.json())).not.toMatch(/test-secret|private raw/);
    }
  });
  it('본문 크기와 다른 origin을 거부', async () => {
    const fetcher = upstream(complete());
    expect((await analyzeContext(request({ consent: true, sources: [{ id: 's0', text: '가'.repeat(16000) }] }), env, fetcher)).status).toBe(
      413,
    );
    const req = request();
    req.headers.set('origin', 'https://other.test');
    expect((await analyzeContext(req, env, fetcher)).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('상류 진단은 허용 코드만 반환하고 원문 메시지는 숨긴다', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ error: { code: 'model_not_found', message: 'private raw document test-secret-not-real' } }, { status: 404 }),
      );
    const response = await analyzeContext(request(), env, fetcher);
    expect(await response.json()).toEqual({ error: 'AI_UNAVAILABLE', upstreamStatus: 404, reason: 'model_not_found' });
  });
  it.each(['allocation', 'conditional_fund', 'action_conflict'] as const)('AI %s를 가져와도 승인·대상·시점은 확정하지 않음', (kind) => {
    const planning = importProposal(emptyPlanning(), { ...proposal, kind, certainty: 'confirmed' }, [], 'ai-test');
    const rows = [...planning.allocations, ...planning.funds, ...planning.actions];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => !r.confirmed && !r.candidateIds.length)).toBe(true);
    expect(planning.allocations.every((r) => !r.assetId && !r.start)).toBe(true);
    expect(planning.actions.every((r) => !r.targetId && r.action === '중단' && r.amount === '17')).toBe(true);
  });
});
