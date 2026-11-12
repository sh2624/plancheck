import { useState } from 'react';
import type { EvidenceRef } from '../validation/types';
import { MAX_BYTES, MAX_SOURCES, readProposals, type Proposal } from '../ai/contract';
import { Button } from './ui/button';
const titles = { allocation: '자산 배정 관계', conditional_fund: '조건부 금액', action_conflict: '계획 행동 관계' };
/** 선택한 문장과 명시적 동의만 전송하며 응답을 확인된 사실로 취급하지 않는다. */
export function AiContextPanel({
  references,
  onImport,
}: {
  references: EvidenceRef[];
  onImport: (p: Proposal, refs: EvidenceRef[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [imported, setImported] = useState<number[]>([]);
  const [metrics, setMetrics] = useState('');
  const options = references
    .map((ref, i) => ({ id: `s${i}`, ref }))
    .filter(
      ({ ref }) => /배정|충당|지원금|세액공제|기여금|보험금|중단|자동이체|유지/.test(ref.originalText) && ref.originalText.length <= 1200,
    );
  const sources = options.filter((o) => selected.includes(o.id)).map((o) => ({ id: o.id, text: o.ref.originalText }));
  /** 실패하더라도 기존 검사 상태를 수정하지 않는다. */
  async function run() {
    setBusy(true);
    setError('');
    setProposals([]);
    setImported([]);
    try {
      const body = JSON.stringify({ consent, sources });
      if (new TextEncoder().encode(body).length > MAX_BYTES) throw new Error();
      const response = await fetch('/api/analyze-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(18000),
      });
      if (!response.ok) throw new Error();
      const result = await response.json();
      setProposals(readProposals({ proposals: result.proposals }, sources));
      setMetrics(
        `처리 ${Math.round(Number(result.metrics?.elapsedMs ?? 0))}ms · 추정 비용 ${typeof result.metrics?.estimatedUsd === 'number' ? `$${result.metrics.estimatedUsd.toFixed(5)}` : '확인 불가'}`,
      );
    } catch {
      setError('AI 분석을 완료하지 못했습니다. 기존 문서 검사는 그대로 사용할 수 있습니다.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="advanced-workspace">
      <summary>선택형 AI 문맥 분석 · Preview 실험</summary>
      <p>
        기본 검사와 별개의 실험입니다. 개인정보가 없는 문장만 선택하세요. 선택한 원문과 임시 식별자가 Vercel 서버를 거쳐 OpenAI로
        전송됩니다. 파일 전체·파일명은 전송하지 않습니다.
      </p>
      <p>
        배정·조건부 금액·계획 행동만 제안합니다. 확정 여부와 적용 시점은 사람이 확인해야 합니다. 요청당 예상 상한 $0.06, 자동 재시도 없음.
      </p>
      {options.map(({ id, ref }) => (
        <label key={id} className="block my-3 break-words">
          <input
            type="checkbox"
            disabled={busy || (!selected.includes(id) && selected.length >= MAX_SOURCES)}
            checked={selected.includes(id)}
            onChange={(e) => {
              setSelected(e.target.checked ? [...selected, id] : selected.filter((s) => s !== id));
              setConsent(false);
              setProposals([]);
              setMetrics('');
            }}
          />{' '}
          {ref.location}
          <br />
          <span>{ref.originalText}</span>
        </label>
      ))}
      {!options.length && <p>분석할 관련 문장이 없습니다.</p>}
      <label className="block my-3">
        <input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} /> 선택한 {sources.length}개
        문장의 외부 전송에 동의합니다.
      </label>
      <Button disabled={!consent || !sources.length || busy} onClick={run}>
        {busy ? '문맥 분석 중' : '선택 문장 분석'}
      </Button>
      <p role="status">{error || metrics}</p>
      {metrics && !proposals.length && <p>제안된 관계가 없습니다. 정상 판정을 의미하지 않습니다.</p>}
      {proposals.map((p, i) => (
        <section key={i} className="py-4 border-b">
          <h3>AI 제안 · {titles[p.kind]}</h3>
          {p.evidence.map((e, j) => (
            <p key={j}>
              {options.find((o) => o.id === e.sourceId)?.ref.location} · {e.quote}
            </p>
          ))}
          <p>{p.uncertainty}</p>
          <Button
            variant="outline"
            disabled={imported.includes(i)}
            onClick={() => {
              onImport(
                p,
                p.evidence.map((e) => options.find((o) => o.id === e.sourceId)!.ref),
              );
              setImported([...imported, i]);
            }}
          >
            {imported.includes(i) ? '확인 후보에 추가됨' : '상세 검토에 확인 후보 추가'}
          </Button>
        </section>
      ))}
    </details>
  );
}
