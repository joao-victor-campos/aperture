export interface GithubAsset {
  name: string
  browser_download_url: string
}

/**
 * Picks the browser download URL of the DMG asset matching the given arch.
 * Asset names follow electron-builder's `${productName}-${version}-${arch}.dmg`
 * (see electron-builder.yml dmg.artifactName), e.g. `Aperture-2.4.0-arm64.dmg`.
 * Returns null when no DMG matches (caller falls back to the release page).
 */
export function selectDmgAsset(assets: GithubAsset[], arch: string): string | null {
  const suffix = `-${arch}.dmg`
  const hit = assets.find((a) => a.name.endsWith(suffix))
  return hit ? hit.browser_download_url : null
}
