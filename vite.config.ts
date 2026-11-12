import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { aiContextEnabled } from './src/config/features.ts';
export default defineConfig(({ mode }) => ({
  define: {
    'import.meta.env.VITE_ENABLE_AI_CONTEXT': JSON.stringify(
      aiContextEnabled(process.env.VERCEL_ENV, loadEnv(mode, process.cwd(), 'VITE_').VITE_ENABLE_AI_CONTEXT) ? 'true' : 'false',
    ),
  },
  plugins: [react(), tailwindcss()],
  // 실제 ZIP/XML UI 테스트의 병렬 jsdom 생성 부하를 제한한다.
  test: {
    environment: 'jsdom',
    maxWorkers: 1,
    include: ['tests/**/*.test.{ts,tsx}'],
  },
}));
