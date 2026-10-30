import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { netlifyDevApi } from './dev/netlifyDevApi.ts';

export default defineConfig({
  plugins: [react(), tailwindcss(), netlifyDevApi()],
  build: { target: 'es2022', sourcemap: false },
  test: { include: ['tests/unit/**/*.test.ts', 'tests/server/**/*.test.ts'] },
} as never);
