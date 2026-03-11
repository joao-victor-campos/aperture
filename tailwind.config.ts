import type { Config } from 'tailwindcss'

/**
 * Semantic colour tokens — values come from CSS custom properties in index.css.
 * Using `rgb(var(--c-*) / <alpha-value>)` so opacity modifiers work:
 *   bg-app-elevated/60  →  rgba(31,41,55,0.6)
 *
 * Light theme: warm off-white + orange accent (default, no class needed)
 * Dark  theme: near-black  + orange accent  (.dark class on <html>)
 */
const config: Config = {
  content: ['./src/renderer/**/*.{html,js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Backgrounds ──────────────────────────────────────────────────────
        'app-bg':       'rgb(var(--c-bg)       / <alpha-value>)',
        'app-surface':  'rgb(var(--c-surface)  / <alpha-value>)',
        'app-elevated': 'rgb(var(--c-elevated) / <alpha-value>)',
        // ── Borders ──────────────────────────────────────────────────────────
        'app-border':   'rgb(var(--c-border)   / <alpha-value>)',
        // ── Text ─────────────────────────────────────────────────────────────
        'app-text':   'rgb(var(--c-text)   / <alpha-value>)',   // primary
        'app-text-2': 'rgb(var(--c-text-2) / <alpha-value>)',   // secondary
        'app-text-3': 'rgb(var(--c-text-3) / <alpha-value>)',   // muted/disabled
        // ── Accent (orange) ──────────────────────────────────────────────────
        'app-accent':        'rgb(var(--c-accent)        / <alpha-value>)',
        'app-accent-hover':  'rgb(var(--c-accent-hover)  / <alpha-value>)',
        'app-accent-subtle': 'rgb(var(--c-accent-subtle) / <alpha-value>)',
        'app-accent-text':   'rgb(var(--c-accent-text)   / <alpha-value>)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
