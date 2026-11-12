import { entityTarget, originalAmount, originalSpan, reject } from './provenance.js';
export type ContextSource = { id: string; text: string };
export const kinds = ['allocation', 'conditional_fund', 'action_conflict'] as const;
export type Proposal = {
  kind: (typeof kinds)[number];
  evidence: {
    sourceId: string;
    quote: string;
    target: string | null;
    number: string | null;
    unit: string | null;
    action: string | null;
    timing: string | null;
  }[];
  uncertainty: string;
  certainty: 'confirmed' | 'conditional' | 'unknown';
};
export const MAX_BYTES = 16000;
export const MAX_SOURCES = 8;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every((n) => n in v);
/** 전송 대상은 파일명 없는 선택 문장으로 제한하며 동의를 서버에서도 확인한다. */
export function readRequest(value: unknown): ContextSource[] {
  if (
    !object(value) ||
    !keys(value, ['consent', 'sources']) ||
    value.consent !== true ||
    !Array.isArray(value.sources) ||
    !value.sources.length ||
    value.sources.length > MAX_SOURCES
  )
    throw new Error('INVALID_REQUEST');
  const ids = new Set<string>();
  return value.sources.map((s: unknown) => {
    if (
      !object(s) ||
      !keys(s, ['id', 'text']) ||
      typeof s.id !== 'string' ||
      !/^s\d{1,4}$/.test(s.id) ||
      ids.has(s.id) ||
      typeof s.text !== 'string' ||
      !s.text.trim() ||
      s.text.length > 1200
    )
      throw new Error('INVALID_SOURCE');
    ids.add(s.id);
    return { id: s.id, text: s.text };
  });
}
/** 구조화 응답도 신뢰하지 않고 출처·인용·숫자·행동의 원문 일치를 재검사한다. */
export function readProposals(value: unknown, sources: ContextSource[]): Proposal[] {
  if (!object(value) || !keys(value, ['proposals']) || !Array.isArray(value.proposals) || value.proposals.length > 12)
    reject('proposals', 'INVALID_OUTPUT', 'structure');
  return value.proposals.map((p: unknown, proposalIndex: number) => {
    const path = `proposals[${proposalIndex}]`;
    let referencedTiming = false;
    if (
      !object(p) ||
      !keys(p, ['kind', 'evidence', 'uncertainty', 'certainty']) ||
      !['confirmed', 'conditional', 'unknown'].includes(p.certainty as string) ||
      !kinds.includes(p.kind as Proposal['kind']) ||
      typeof p.uncertainty !== 'string' ||
      p.uncertainty.length > 500 ||
      !Array.isArray(p.evidence) ||
      !p.evidence.length ||
      p.evidence.length > 8
    )
      reject(path, 'INVALID_PROPOSAL', 'structure');
    const rawEvidence = p.evidence;
    const evidence = rawEvidence.map((e: unknown, evidenceIndex: number) => {
      const base = `${path}.evidence[${evidenceIndex}]`;
      if (
        !object(e) ||
        !keys(e, ['sourceId', 'quote', 'target', 'number', 'unit', 'action', 'timing']) ||
        typeof e.sourceId !== 'string' ||
        typeof e.quote !== 'string' ||
        !e.quote ||
        (e.target !== null && typeof e.target !== 'string')
      )
        reject(base, 'INVALID_EVIDENCE', 'structure');
      const source = sources.find((s) => s.id === e.sourceId);
      if (!source) reject(`${base}.sourceId`, 'UNSUPPORTED_SOURCE', 'source');
      const quote = originalSpan(source.text, e.quote);
      if (!quote) reject(`${base}.quote`, 'UNSUPPORTED_SOURCE', 'source');
      const target = e.target === null ? null : originalSpan(quote, e.target);
      if (e.target !== null && !entityTarget(e.target)) reject(`${base}.target`, 'TARGET_NOT_ENTITY', 'target');
      if (e.target !== null && !target) reject(`${base}.target`, 'UNSUPPORTED_SOURCE', 'target');
      const absent = (value: unknown) => (value === 'null' ? null : value);
      const number = absent(e.number),
        unit = absent(e.unit),
        action = absent(e.action);
      let timing = absent(e.timing);
      let amount: { number: string; unit: string } | null = null;
      if (number !== null || unit !== null) {
        if (typeof number !== 'string') reject(`${base}.number`, 'UNSUPPORTED_NUMBER', 'amount');
        if (typeof unit !== 'string') reject(`${base}.unit`, 'INVALID_UNIT', 'amount');
        amount = originalAmount(number, unit, quote);
        if (!amount) reject(base, 'UNSUPPORTED_AMOUNT_UNIT', 'amount', ['number', 'unit']);
      }
      if (typeof timing === 'string' && !originalSpan(quote, timing) && /(?:같은|동일한?|해당)\s*(?:기간|시점|날짜)/.test(quote)) {
        const literal = timing;
        const supporting = rawEvidence.some(
          (other: unknown) =>
            object(other) &&
            other.sourceId !== e.sourceId &&
            typeof other.sourceId === 'string' &&
            typeof other.quote === 'string' &&
            sources.some(
              (s) => s.id === other.sourceId && originalSpan(s.text, other.quote as string) && originalSpan(other.quote as string, literal),
            ),
        );
        if (supporting) {
          timing = null;
          referencedTiming = true;
        }
      }
      for (const [field, value] of [
        ['action', action],
        ['timing', timing],
      ] as const) {
        if (value !== null && (typeof value !== 'string' || !originalSpan(quote, value)))
          reject(`${base}.${field}`, 'UNSUPPORTED_LITERAL', field);
      }
      if (
        action !== null &&
        (!['유지', '중단', '시작', '증액', '감액'].includes(action as string) ||
          /하지|않|말고|말아/.test(quote) ||
          ['유지', '중단', '시작', '증액', '감액'].filter((a) => quote.includes(a)).length !== 1)
      )
        reject(`${base}.action`, 'AMBIGUOUS_ACTION', 'action');
      return {
        sourceId: e.sourceId,
        quote,
        target,
        number: amount?.number ?? null,
        unit: amount?.unit ?? null,
        action: action as string | null,
        timing: timing === null ? null : originalSpan(quote, timing as string),
      };
    });
    if (p.kind === 'action_conflict' && new Set(evidence.map((e) => e.target?.replace(/\s/g, '')).filter(Boolean)).size > 1)
      reject(`${path}.evidence`, 'RELATION_TARGET_MISMATCH', 'target');
    return {
      kind: p.kind as Proposal['kind'],
      evidence,
      uncertainty: p.uncertainty + (referencedTiming ? ' 적용 시점은 다른 문장을 참조하므로 확인 필요.' : ''),
      certainty: referencedTiming || evidence.some((e) => e.target === null) ? 'unknown' : (p.certainty as Proposal['certainty']),
    };
  });
}
const nullable = { type: ['string', 'null'] };
export const outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['proposals'],
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'evidence', 'uncertainty', 'certainty'],
        properties: {
          certainty: { type: 'string', enum: ['confirmed', 'conditional', 'unknown'] },
          kind: { type: 'string', enum: kinds },
          uncertainty: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['sourceId', 'quote', 'target', 'number', 'unit', 'action', 'timing'],
              properties: {
                sourceId: { type: 'string' },
                quote: { type: 'string' },
                target: {
                  type: ['string', 'null'],
                  description:
                    'Exact asset, product or benefit name in this quote, never an amount, currency unit or goal. Null if absent.',
                },
                number: {
                  type: ['string', 'null'],
                  pattern: '^-?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?$',
                  description: 'Digits only, without unit. Use JSON null if absent.',
                },
                unit: { type: ['string', 'null'], enum: ['원', '만원', '만 원', '억원', '억 원', '%', '개월', '년', null] },
                action: { type: ['string', 'null'], enum: ['유지', '중단', '시작', '증액', '감액', null] },
                timing: nullable,
              },
            },
          },
        },
      },
    },
  },
};
