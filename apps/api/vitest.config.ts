import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    include: ['test/**/*.test.ts'],
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30_000,
  },
});
