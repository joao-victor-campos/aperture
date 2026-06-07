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
  const c0A = hexToRgb(b.base0A) // warn (yellow)
  const c0B = hexToRgb(b.base0B) // ok (green)
  const c08 = hexToRgb(b.base08) // err (red)
  const c0D = hexToRgb(b.base0D) // blue (functions)
  const c0F = hexToRgb(b.base0F) // deprecated (used to blend hover)

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
    `  --c-state-ok: ${rgbString(b.base0B)};`,
    `  --c-state-ok-subtle: ${blend(bg, c0B, 0.18)};`,
    `  --c-state-warn: ${rgbString(b.base0A)};`,
    `  --c-state-warn-subtle: ${blend(bg, c0A, 0.18)};`,
    `  --c-state-err: ${rgbString(b.base08)};`,
    `  --c-state-err-subtle: ${blend(bg, c08, 0.18)};`,
    // Categorical
    `  --c-cat-blue: ${rgbString(b.base0D)};`,
    `  --c-cat-blue-subtle: ${blend(bg, c0D, 0.16)};`,
    `  --c-cat-purple: ${rgbString(b.base0E)};`,
    `  --c-cat-green: ${rgbString(b.base0B)};`,
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
 */
export function applyTheme(theme: Theme | null): void {
  const existing = document.getElementById(STYLE_TAG_ID)
  if (theme === null) {
    if (existing) existing.remove()
    return
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
}
