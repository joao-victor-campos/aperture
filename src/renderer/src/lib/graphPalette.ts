/**
 * Color palette for graph nodes and relationship types. Cycles through the
 * existing categorical accent tokens so the graph view stays visually
 * consistent with the catalog tree and connection breadcrumb.
 *
 * Past 5 distinct labels the palette wraps — this is the "gracefully cycling
 * beyond ~6 distinct labels" point from the design spec.
 */
export const NODE_PALETTE = [
  'rgb(var(--c-cat-teal))',
  'rgb(var(--c-cat-blue))',
  'rgb(var(--c-cat-purple))',
  'rgb(var(--c-cat-green))',
  'rgb(var(--c-accent))',
] as const

/** Maps a label / relationship-type name to a palette color via a stable hash. */
export function paletteColor(label: string): string {
  if (label === '(unknown)') return 'rgb(var(--c-text-3))'
  let hash = 0
  for (let i = 0; i < label.length; i++) {
    hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0
  }
  return NODE_PALETTE[Math.abs(hash) % NODE_PALETTE.length]
}
