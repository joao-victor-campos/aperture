/**
 * Compares two semver-ish version strings by their numeric major.minor.patch
 * core. A leading `v` and any prerelease/build suffix are ignored.
 *
 * Returns 1 if a > b, -1 if a < b, 0 if equal OR if either side is unparseable
 * (returning 0 on garbage guarantees we never report a false "update available").
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1
    if (pa[i] < pb[i]) return -1
  }
  return 0
}

function parse(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}
