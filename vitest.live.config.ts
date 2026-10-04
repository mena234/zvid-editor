import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/live-e2e/*.test.ts'] } })
