import { expect, it } from 'vitest';
import { aiContextEnabled } from '../src/config/features';
it.each([
  ['production', 'true', false],
  ['production', 'false', false],
  [undefined, 'true', false],
  ['preview', undefined, false],
  ['preview', 'false', false],
  ['preview', 'true', true],
])('환경 %s, 플래그 %s에서 AI 화면 허용은 %s', (environment, flag, enabled) => {
  expect(aiContextEnabled(environment as string | undefined, flag as string | undefined)).toBe(enabled);
});
