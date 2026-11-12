/** AI 화면은 명시적으로 허용한 Preview 빌드에서만 포함한다. */
export function aiContextEnabled(environment: string | undefined, flag: string | undefined): boolean {
  return environment === 'preview' && flag === 'true';
}
