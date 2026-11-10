import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 실제 ZIP/XML UI 테스트의 병렬 jsdom 생성 부하를 제한한다.
  test: {
    environment: 'jsdom',
    maxWorkers: 2,
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
