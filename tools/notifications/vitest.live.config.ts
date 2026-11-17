import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tools/notifications/hook-live.test.ts'],environment:'node',testTimeout:120_000}});
