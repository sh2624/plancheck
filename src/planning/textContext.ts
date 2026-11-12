import { dateValue } from './engine';
/** 문장에 실제 적힌 ISO 기간·시나리오만 읽고 상대 시점은 원문 표현으로 남긴다. */
export function textContext(text: string) {
  const range = text.match(/(\d{4}-\d{2}-\d{2})\s*(?:~|～|부터|–)\s*(\d{4}-\d{2}-\d{2})/);
  const valid = range && dateValue(range[1]) !== null && dateValue(range[2]) !== null && range[1] <= range[2];
  return {
    start: valid ? range[1] : '',
    end: valid ? range[2] : '',
    scenario: text.match(/기본안|대체안|시나리오\s*[A-Z가-힣0-9]+/)?.[0] ?? '',
    timing: range?.[0] ?? text.match(/\d+\s*(?:년|개월)\s*후|\d{4}년(?:\s*\d{1,2}월)?|동일\s*기간|같은\s*기간|동시|현재/)?.[0] ?? '',
  };
}
