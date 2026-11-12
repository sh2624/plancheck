import { dateValue } from '../planning/engine';
export type ContextEvidence = {
  field: 'asOf' | 'scenario';
  value: string;
  location: string;
  scope: 'sheet' | 'document' | 'table' | 'paragraph';
  basis: '명시' | '범위 상속';
};
export type Context = { asOf: string; scenario: string; evidence: ContextEvidence[] };
export const emptyContext = (): Context => ({ asOf: '', scenario: '', evidence: [] });
/** 명시된 날짜·시나리오만 읽고 출처와 선언 범위를 보존한다. 없는 기본 시나리오는 만들지 않는다. */
export function readContext(text: string, location: string, scope: ContextEvidence['scope']): Context {
  const date = text.match(/기준\s*(?:시점|시기|일)?\s*[:：|]?\s*(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})일?/);
  const iso = date ? `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}` : '';
  const asOf = iso && dateValue(iso) !== null ? iso : '';
  const scenario = text.match(/(?:[A-D]안|대체\s*시나리오|기본안|대체안|위기\s*예산|시나리오\s*[A-D가-힣0-9]+)/)?.[0] ?? '';
  return {
    asOf,
    scenario,
    evidence: (
      [
        ['asOf', asOf],
        ['scenario', scenario],
      ] as const
    )
      .filter(([, v]) => !!v)
      .map(([field, value]) => ({ field, value, location, scope, basis: '명시' })),
  };
}
/** 새 선언만 덮어쓰며 상속한 값은 별도 근거로 구분한다. */
export function inheritContext(previous: Context, declared: Context): Context {
  return {
    asOf: declared.asOf || previous.asOf,
    scenario: declared.scenario || previous.scenario,
    evidence: [
      ...previous.evidence.filter((e) => !declared[e.field]).map((e) => ({ ...e, basis: '범위 상속' as const })),
      ...declared.evidence,
    ],
  };
}
