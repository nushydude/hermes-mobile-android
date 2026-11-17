import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['tools/smoke/rename-live.test.ts'],environment:'node',testTimeout:45000}});
