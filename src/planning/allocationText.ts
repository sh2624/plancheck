import type { EvidenceRef } from '../validation/types';
import { unitOf } from '../normalization/values';
import { textContext } from './textContext';
const amount = '(\\d[\\d,]*(?:\\.\\d+)?)\\s*(억\\s*원|만\\s*원|원)';
/** 자산→목표의 명시적 배정·확보·충당 문장만 읽는다. 관계 없는 보유액·목표는 결합하지 않는다. */
export function allocationText(ref: EvidenceRef) {
  const output: {
    asset: string;
    goal: string;
    amount: string;
    unit: ReturnType<typeof unitOf>;
    index: number;
    context: ReturnType<typeof textContext>;
    future: boolean;
  }[] = [];
  for (const [index, clause] of ref.originalText.split(/(?<=[가-힣])\.\s+|[;\n]/).entries()) {
    if (/하지|않|미배정|참고|대신/.test(clause)) continue;
    const direct = clause.match(
      new RegExp(
        '(?:^|[:：])\\s*([^:：|]+?)\\s*' + amount + '(?:을|를)?\\s*([^:：|]+?)(?:으로|에)\\s*(?:우선\\s*)?(?:확보|배정|할당|사용)',
      ),
    );
    const reverse = clause.match(
      new RegExp('(?:^|[:：])\\s*([^:：|]+?)\\s*' + amount + '(?:은|는|을|를)?\\s*([^:：|]+?)에서\\s*(?:충당|배정|사용)'),
    );
    const m = direct ?? reverse;
    if (!m) continue;
    output.push({
      asset: (direct ? m[1] : m[4]).trim().replace(/^(?:현재\s*보유한|보유|현재)\s*/, ''),
      goal: (direct ? m[4] : m[1]).trim(),
      amount: m[2],
      unit: unitOf(m[3]),
      index,
      context: textContext(clause),
      future: /새로|신규\s*적립|이후\s*적립|미래\s*적립/.test(clause),
    });
  }
  // 한 배정 뒤에 붙은 유일한 조건 선언만 상속한다. 여러 배정·기간이 섞인 문장은 보완하지 않는다.
  if (output.length === 1 && (ref.originalText.match(/\d{4}-\d{2}-\d{2}\s*(?:~|～|부터|–)/g)?.length ?? 0) <= 1) {
    const context = textContext(ref.originalText);
    output[0].context = { ...output[0].context, ...Object.fromEntries(Object.entries(context).filter(([, v]) => !!v)) };
  }
  return output;
}
