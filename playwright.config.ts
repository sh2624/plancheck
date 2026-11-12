import { defineConfig } from '@playwright/test';
const deployedURL = process.env.PLANCHECK_E2E_BASE_URL;
if (deployedURL) {
  const url = new URL(deployedURL);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (!['plancheck.cloud', 'www.plancheck.cloud'].includes(url.hostname) && !/^plancheck-[a-z0-9-]+\.vercel\.app$/.test(url.hostname))
  )
    throw new Error('PlanCheck의 HTTPS 배포 기본 주소만 사용할 수 있습니다.');
}
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 10000 },
  use: {
    baseURL: deployedURL ?? 'http://127.0.0.1:4173',
    storageState: deployedURL ? process.env.PLANCHECK_E2E_STORAGE_STATE : undefined,
    browserName: 'chromium',
    channel: process.env.PLANCHECK_BROWSER_CHANNEL ?? 'chrome',
    viewport: { width: 1440, height: 1000 },
    trace: deployedURL ? 'off' : 'retain-on-failure',
    screenshot: deployedURL ? 'off' : 'only-on-failure',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: deployedURL
    ? undefined
    : {
        command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: false,
        timeout: 30000,
      },
});
