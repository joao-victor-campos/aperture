import type { Config } from 'tailwindcss'

/**
 * Semantic colour tokens — values come from CSS custom properties in index.css.
 * Using `rgb(var(--c-*) / <alpha-value>)` so opacity modifiers work:
 *   bg-app-elevated/60  →  rgba(31,41,55,0.6)
 *
 * Direction D · Hybrid — Linear precision × Atelier warmth.
 *
 * Light theme: warm paper + refined terracotta (default, no class needed)
 * Dark  theme: warm coffee + brighter terracotta (.dark class on <html>)
 *
 * All previous token names are preserved — existing components keep working.
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
        'app-sidebar':  'rgb(var(--c-sidebar)  / <alpha-value>)',  // NEW
        'app-elevated': 'rgb(var(--c-elevated) / <alpha-value>)',

        // ── Borders (hairlines) ──────────────────────────────────────────────
        'app-border':   'rgb(var(--c-border)   / <alpha-value>)',
        'app-border-2': 'rgb(var(--c-border-2) / <alpha-value>)',  // NEW

        // ── Text ─────────────────────────────────────────────────────────────
        'app-text':   'rgb(var(--c-text)   / <alpha-value>)',   // primary
        'app-text-2': 'rgb(var(--c-text-2) / <alpha-value>)',   // secondary
        'app-text-3': 'rgb(var(--c-text-3) / <alpha-value>)',   // muted
        'app-text-4': 'rgb(var(--c-text-4) / <alpha-value>)',   // faintest — NEW

        // ── Accent (refined terracotta) ──────────────────────────────────────
        'app-accent':         'rgb(var(--c-accent)         / <alpha-value>)',
        'app-accent-hover':   'rgb(var(--c-accent-hover)   / <alpha-value>)',
        'app-accent-subtle':  'rgb(var(--c-accent-subtle)  / <alpha-value>)',
        'app-accent-sub-2':   'rgb(var(--c-accent-sub-2)   / <alpha-value>)',  // NEW
        'app-accent-text':    'rgb(var(--c-accent-text)    / <alpha-value>)',

        // ── State (semantic) ──────────────────────────────────────────────── NEW
        'app-ok':          'rgb(var(--c-state-ok)           / <alpha-value>)',
        'app-ok-subtle':   'rgb(var(--c-state-ok-subtle)    / <alpha-value>)',
        'app-warn':        'rgb(var(--c-state-warn)         / <alpha-value>)',
        'app-warn-subtle': 'rgb(var(--c-state-warn-subtle)  / <alpha-value>)',
        'app-err':         'rgb(var(--c-state-err)          / <alpha-value>)',
        'app-err-subtle':  'rgb(var(--c-state-err-subtle)   / <alpha-value>)',

        // ── Categorical (icons & badges) ──────────────────────────────────── NEW
        'app-cat-blue':         'rgb(var(--c-cat-blue)         / <alpha-value>)',
        'app-cat-blue-subtle':  'rgb(var(--c-cat-blue-subtle)  / <alpha-value>)',
        'app-cat-purple':       'rgb(var(--c-cat-purple)       / <alpha-value>)',
        'app-cat-green':        'rgb(var(--c-cat-green)        / <alpha-value>)',
        'app-cat-teal':         'rgb(var(--c-cat-teal)         / <alpha-value>)',
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont',
          'SF Pro Text', 'Segoe UI', 'Roboto', 'sans-serif',
        ],
        mono: ['JetBrains Mono', 'SF Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      fontSize: {
        // Tight UI scale tuned for desktop density (13px body)
        'ui-xs':  ['10.5px', { lineHeight: '14px',  letterSpacing: '0.04em' }],
        'ui-sm':  ['11.5px', { lineHeight: '16px' }],
        'ui':     ['12.5px', { lineHeight: '17px' }],
        'ui-md':  ['13px',   { lineHeight: '18px' }],
        'ui-lg':  ['14px',   { lineHeight: '20px' }],
      },
      boxShadow: {
        // Hairline-on-hairline elevation — for active pill tabs, etc.
        'app-pill': 'inset 0 0 0 1px rgb(var(--c-border)), 0 1px 0 rgb(0 0 0 / 0.02)',
        'app-card': '0 1px 0 rgb(0 0 0 / 0.02), 0 4px 12px rgb(60 40 20 / 0.06)',
      },
      letterSpacing: {
        'caps': '0.10em',  // small-caps section labels
        'tight-ui': '-0.005em',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'palette-in': {
          from: { opacity: '0', transform: 'scale(0.98) translateY(-4px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'panel-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'modal-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        // `animate-fade-in` was referenced by the "✓ Query updated" toast
        // (Editor.tsx) but never defined — this makes it real.
        'fade-in': 'fade-in 150ms ease-out',
        'palette-in': 'palette-in 140ms cubic-bezier(0.16, 1, 0.3, 1)',
        'panel-in': 'panel-in 160ms ease-out',
        'modal-in': 'modal-in 150ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
}

export default config
