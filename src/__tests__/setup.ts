import { vi } from 'vitest'

/**
 * Global test setup.
 * Runs before every test file in both node and jsdom environments.
 */

// ── Renderer (jsdom) environment ─────────────────────────────────────────────
// The renderer stores expect window.api (exposed via contextBridge in production).
// We stub it so modules that register listeners at import time don't throw.
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>)['api'] = {
    invoke: vi.fn(),
    on: vi.fn(),
    off: vi.fn()
  }
}

// ── react-force-graph-2d stub ────────────────────────────────────────────────
// The canvas library drives raw 2D-context APIs jsdom doesn't implement; any
// test that transitively imports GraphView would choke without this. The stub
// renders nothing — graph behavior is covered by the pure-utility tests
// (buildGraphFromRecords / detectGraphShape / graphPalette).
vi.mock('react-force-graph-2d', () => ({
  __esModule: true,
  default: vi.fn(() => null)
}))
