// 비식별 합성 문장만 전송한다. 실행은 사용자가 배포한 보호된 Preview 주소에 한정한다.
const base = process.env.PLANCHECK_PREVIEW_URL;
if (!base || !/^https:\/\/[\w.-]+\.vercel\.app\/?$/.test(base)) throw new Error('PLANCHECK_PREVIEW_URL에 Preview HTTPS 주소를 지정하세요.');
const cases = [
  ['allocation', ['가상 예금 730만 원을 비상자금에 배정한다.', '같은 예금 730만 원 중 280만 원을 같은 기간 의료비에 배정한다.']],
  ['conditional_fund', ['가상 지원금 127만 원은 미승인·미수령이지만 현재 확정 자산에 포함한다.']],
  ['action_conflict', ['제안: 가상 ETF 월 17만 원 적립 중단.', '실행: 같은 ETF를 같은 기간 월 17만 원 자동이체 유지.']],
  [null, ['가상 예금 현재 잔액 730만 원. 다른 계획이나 배정은 없다.']],
];
const results = [];
for (const [kind, texts] of cases) {
  const started = Date.now();
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/api/analyze-context`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(22000),
      body: JSON.stringify({ consent: true, sources: texts.map((text, i) => ({ id: `s${i}`, text })) }),
    });
    if (!response.ok) {
      results.push({ kind, status: response.status, success: false });
      continue;
    }
    const body = await response.json();
    results.push({
      kind,
      success: kind === null ? body.proposals.length === 0 : body.proposals.some((p) => p.kind === kind),
      proposals: body.proposals.length,
      elapsedMs: Date.now() - started,
      estimatedUsd: body.metrics?.estimatedUsd ?? null,
    });
  } catch {
    results.push({ kind, success: false, error: 'REQUEST_FAILED' });
  }
}
console.log(JSON.stringify({ syntheticOnly: true, confirmedErrorsEvaluated: false, results }, null, 2));
