/**
 * applyTheme.ts
 * Pure token mapping + CSS injection for imported Base16 themes.
 *
 * Maps the 16 standard Base16 slots (base00–base0F) onto Aperture's full
 * design-token palette (~30 CSS custom properties), deriving the "subtle"
 * background variants via linear blending toward base00.
 *
 * Pass `null` to remove an imported override and restore the built-in
 * palette defined in index.css.
 */
import type { Theme } from '../../../shared/types'

const STYLE_TAG_ID = 'aperture-theme'
const CACHE_KEY = 'aperture-theme-css'
const LIGHT_SENTINEL = '__aperture_light__'

export type RGB = [number, number, number]

export function hexToRgb(hex: string): RGB {
  const clean = hex.replace(/^#/, '')
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ]
}

/** Mix bg and fg at the given alpha (0 = bg, 1 = fg). Returns "R G B" string. */
export function blend(bg: RGB, fg: RGB, alpha: number): string {
  return [0, 1, 2]
    .map((i) => Math.round(bg[i] * (1 - alpha) + fg[i] * alpha))
    .join(' ')
}

/** "R G B" string from a hex (no leading #). */
function rgbString(hex: string): string {
  return hexToRgb(hex).join(' ')
}

/** Build the `:root { ... }` CSS block. Pure — no DOM access. */
function buildCss(theme: Theme): string {
  const b = theme.base
  const bg = hexToRgb(b.base00)
  const c09 = hexToRgb(b.base09) // accent (orange)
  const c0A = hexToRgb(b.base0a) // warn (yellow)
  const c0B = hexToRgb(b.base0b) // ok (green)
  const c08 = hexToRgb(b.base08) // err (red)
  const c0D = hexToRgb(b.base0d) // blue (functions)
  // base0F's Base16 meaning is "deprecated/embedded tags" — repurposed here
  // as a deeper shade to blend with the accent for the hover state.
  const c0F = hexToRgb(b.base0f)

  const lines: string[] = [
    `:root {`,
    // Backgrounds
    `  --c-bg: ${rgbString(b.base00)};`,
    `  --c-sidebar: ${rgbString(b.base01)};`,
    `  --c-surface: ${rgbString(b.base02)};`,
    `  --c-elevated: ${rgbString(b.base02)};`,
    // Borders
    `  --c-border: ${rgbString(b.base03)};`,
    `  --c-border-2: ${rgbString(b.base04)};`,
    // Text
    `  --c-text: ${rgbString(b.base05)};`,
    `  --c-text-2: ${rgbString(b.base06)};`,
    `  --c-text-3: ${rgbString(b.base04)};`,
    `  --c-text-4: ${rgbString(b.base03)};`,
    // Accent
    `  --c-accent: ${rgbString(b.base09)};`,
    `  --c-accent-hover: ${blend(c09, c0F, 0.35)};`,
    `  --c-accent-subtle: ${blend(bg, c09, 0.14)};`,
    `  --c-accent-sub-2: ${blend(bg, c09, 0.22)};`,
    `  --c-accent-text: ${rgbString(b.base09)};`,
    // Status — ok/warn/err
    `  --c-state-ok: ${rgbString(b.base0b)};`,
    `  --c-state-ok-subtle: ${blend(bg, c0B, 0.18)};`,
    `  --c-state-warn: ${rgbString(b.base0a)};`,
    `  --c-state-warn-subtle: ${blend(bg, c0A, 0.18)};`,
    `  --c-state-err: ${rgbString(b.base08)};`,
    `  --c-state-err-subtle: ${blend(bg, c08, 0.18)};`,
    // Categorical
    `  --c-cat-blue: ${rgbString(b.base0d)};`,
    `  --c-cat-blue-subtle: ${blend(bg, c0D, 0.16)};`,
    `  --c-cat-purple: ${rgbString(b.base0e)};`,
    `  --c-cat-green: ${rgbString(b.base0b)};`,
    `}`,
  ]
  return lines.join('\n')
}

/**
 * Apply a theme by injecting a <style id="aperture-theme"> override into <head>.
 * Passing `null` removes the override and restores the built-in index.css palette.
 *
 * Also removes the `.dark` class from <html> when applying an imported theme,
 * so the built-in dark overrides do not combine with the imported palette.
 *
 * The applied CSS is also persisted to localStorage so that `bootstrapTheme()`
 * can re-apply it synchronously at the next app boot, avoiding a FOUC.
 */
export function applyTheme(theme: Theme | null): void {
  const existing = document.getElementById(STYLE_TAG_ID)
  if (theme === null) {
    if (existing) existing.remove()
    // Re-add .dark so the built-in dark palette in index.css applies again.
    document.documentElement.classList.add('dark')
    try { localStorage.removeItem(CACHE_KEY) } catch { /* localStorage unavailable */ }
    return
  }
  // Defensive: if the theme is malformed (missing or non-hex slot), fall back
  // to the built-in palette instead of rendering garbage.
  const REQUIRED_SLOTS = ['base00','base01','base02','base03','base04','base05','base06','base08','base09','base0a','base0b','base0d','base0e','base0f']
  for (const slot of REQUIRED_SLOTS) {
    const v = theme.base[slot]
    if (typeof v !== 'string' || !/^[0-9a-f]{6}$/.test(v)) {
      // Treat as "no theme" — restore built-in
      if (existing) existing.remove()
      document.documentElement.classList.add('dark')
      try { localStorage.removeItem(CACHE_KEY) } catch { /* localStorage unavailable */ }
      return
    }
  }

  const css = buildCss(theme)
  if (existing) {
    existing.textContent = css
  } else {
    const styleEl = document.createElement('style')
    styleEl.id = STYLE_TAG_ID
    styleEl.textContent = css
    document.head.appendChild(styleEl)
  }
  document.documentElement.classList.remove('dark')
  try { localStorage.setItem(CACHE_KEY, css) } catch { /* localStorage unavailable or quota */ }
}

/**
 * Inject the previously-applied theme synchronously at app boot, before any
 * React rendering, to prevent a flash of the wrong palette.
 *
 * Boot sequence:
 *   - no cache  → built-in Aperture Dark (add `.dark` class)
 *   - LIGHT_SENTINEL → built-in Aperture Light (remove `.dark` class)
 *   - CSS text  → imported theme (inject as <style> tag, remove `.dark`)
 *
 * Call this from main.tsx before createRoot(...).render(...).
 */
export function bootstrapTheme(): void {
  let cached: string | null = null
  try {
    cached = localStorage.getItem(CACHE_KEY)
  } catch {
    document.documentElement.classList.add('dark')
    return
  }
  if (!cached) {
    // First boot or Aperture Dark was last active — apply built-in dark
    document.documentElement.classList.add('dark')
    return
  }
  if (cached === LIGHT_SENTINEL) {
    document.documentElement.classList.remove('dark')
    return
  }
  // Cached value is CSS for an imported theme
  const existing = document.getElementById(STYLE_TAG_ID)
  if (existing) {
    existing.textContent = cached
  } else {
    const styleEl = document.createElement('style')
    styleEl.id = STYLE_TAG_ID
    styleEl.textContent = cached
    document.head.appendChild(styleEl)
  }
  document.documentElement.classList.remove('dark')
}

/**
 * Apply the built-in Aperture Light palette: removes any injected override,
 * removes the `.dark` class so `:root` values in index.css apply, and caches
 * the selection so `bootstrapTheme()` can restore it next boot.
 */
export function applyBuiltinLight(): void {
  const existing = document.getElementById(STYLE_TAG_ID)
  if (existing) existing.remove()
  document.documentElement.classList.remove('dark')
  try {
    localStorage.setItem(CACHE_KEY, LIGHT_SENTINEL)
  } catch {
    /* localStorage unavailable */
  }
}
