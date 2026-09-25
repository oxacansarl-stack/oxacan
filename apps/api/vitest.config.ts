import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
export default defineConfig({
  test: { include: ['test/**/*.e2e.test.ts'], globalSetup: ['test/setup.ts'], fileParallelism: false, testTimeout: 30000, hookTimeout: 90000 },
  plugins: [swc.vite({ jsc: { transform: { legacyDecorator: true, decoratorMetadata: true } } })],
});
