import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/specs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Electron instances are heavyweight and the suite shares one build — run serially.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'test-results',
})
