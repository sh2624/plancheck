/** 기본 날짜·시간 ID와 실제 서식 토큰을 판별하고 인용·이스케이프된 문자는 무시한다. */
export function isDateTimeFormat(id: number | undefined, code = ''): boolean {
  if (id !== undefined && ((id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58)))
    return true;
  const tokens = code
    .replace(/"[^"]*"|\\.|_.|\*./g, '')
    .replace(/\[([^\]]*)\]/g, (_, value: string) => (/^(?:h+|m+|s+)$/i.test(value) ? value : ''))
    .replace(/general/gi, '');
  return /[ymdhs]|AM\/PM|A\/P/i.test(tokens);
}
