import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  // Use React's automatic JSX runtime so component tests (.tsx) don't need a
  // `React` import; mirrors how the renderer itself is built.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },

  test: {
    globals: true,
    clearMocks: true, // auto-clear mock call history between tests (keeps implementations)

    // Exclude git worktrees — they live inside the repo but should not be tested here
    // Exclude e2e tests — Playwright specs, not Vitest unit tests
    exclude: ['node_modules/**', '.claude/worktrees/**', 'e2e/**'],

    // jsdom for renderer tests (window / DOM APIs); node is the default for everything else
    environmentMatchGlobs: [['src/__tests__/renderer/**', 'jsdom']],

    setupFiles: ['src/__tests__/setup.ts'],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage',

      // 70 % minimum across all covered files
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70
      },

      // Only measure coverage for the files we actually test
      include: [
        'src/main/db/**/*.ts',
        'src/main/ipc/**/*.ts',
        'src/renderer/src/store/**/*.ts',
        'src/renderer/src/lib/**/*.ts'
      ],
      exclude: [
        'src/main/index.ts',
        '**/*.d.ts',
        '**/__tests__/**'
      ]
    }
  },

  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  }
})
