import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['app/src/state/**/*.test.ts'], environment: 'node' } });
