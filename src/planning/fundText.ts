import { unitOf } from '../normalization/values';
/** 반영 동사가 있는 문장에서 혜택별로 바로 뒤의 금액만 읽고 총자산 금액을 지급액으로 가져오지 않는다. */
export function reflectedFunds(text: string) {
  if (!/포함|합산|반영/.test(text) || /미반영|포함하지|합산하지|반영하지/.test(text)) return [];
  return [...text.matchAll(/세액공제|정부기여금|지원금|보험금|환급금/g)].map((m) => {
    const prefix = (
      text
        .slice(0, m.index)
        .split(/원(?:과|와)?\s*|[.,:：|]/)
        .at(-1) ?? ''
    )
      .trim()
      .replace(/^(?:미승인|미수령|예상|미확정|조건부)\s*/g, '')
      .split(/\s+/)
      .slice(-2)
      .join(' ');
    const following = text.slice(m.index! + m[0].length);
    const value = following.match(
      /^\s*(?:예상액|예상|금액|은|는|약|의|이|가|을|를|\s)*\s*([+-]?\d[\d,]*(?:\.\d+)?)\s*(억\s*원|만\s*원|원)/,
    );
    return { label: `${prefix} ${m[0]}`.trim(), amount: value?.[1] ?? '', unit: value ? unitOf(value[2]) : ('미확인' as const) };
  });
}
