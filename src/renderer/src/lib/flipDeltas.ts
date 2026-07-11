/** Minimal rect shape consumed by the FLIP hook — only the left edge matters. */
export interface FlipRect {
  left: number
}

/**
 * FLIP "invert" math: for every id present in BOTH snapshots, the signed
 * horizontal distance from its new position back to its old one.
 * Ids that entered or left between snapshots are ignored — only moves animate
 * (tab open/close stays instant by design).
 */
export function computeFlipDeltas(
  prev: ReadonlyMap<string, FlipRect>,
  next: ReadonlyMap<string, FlipRect>,
): Map<string, number> {
  const deltas = new Map<string, number>()
  for (const [id, nextRect] of next) {
    const prevRect = prev.get(id)
    if (!prevRect) continue
    const dx = prevRect.left - nextRect.left
    if (dx !== 0) deltas.set(id, dx)
  }
  return deltas
}
