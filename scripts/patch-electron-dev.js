/**
 * patch-electron-dev.js
 *
 * Patches the Electron app bundle used in development so that:
 *   - The dock icon shows the Aperture aperture logo (not the Electron icon)
 *   - The dock label / menu bar / Cmd+Tab show "Aperture" (not "Electron")
 *
 * Copies resources/icon.icns → Electron.app/Contents/Resources/electron.icns
 * Patches Electron.app/Contents/Info.plist CFBundleName + CFBundleDisplayName
 *
 * Run automatically via the "predev" npm hook. Safe to run multiple times.
 * Changes are scoped to node_modules and are reset after `npm install`,
 * at which point postinstall re-runs this script automatically.
 */

'use strict'

const { copyFileSync, readFileSync, writeFileSync, existsSync } = require('fs')
const path = require('path')

const root        = path.join(__dirname, '..')
const iconSrc     = path.join(root, 'resources', 'icon.icns')
const bundleRes   = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Resources')
const iconDest    = path.join(bundleRes, 'electron.icns')
const plistPath   = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Info.plist')

if (!existsSync(iconSrc)) {
  console.warn('patch-electron-dev: resources/icon.icns not found — skipping')
  process.exit(0)
}

if (!existsSync(iconDest)) {
  console.warn('patch-electron-dev: Electron bundle not found — skipping')
  process.exit(0)
}

// ── 1. Replace the icon ──────────────────────────────────────────────────────
copyFileSync(iconSrc, iconDest)
console.log('patch-electron-dev: replaced electron.icns with Aperture icon')

// ── 2. Patch the Info.plist name fields ─────────────────────────────────────
let plist = readFileSync(plistPath, 'utf8')

plist = plist
  .replace(
    /<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/,
    '<key>CFBundleDisplayName</key>\n\t<string>Aperture</string>'
  )
  .replace(
    /<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/,
    '<key>CFBundleName</key>\n\t<string>Aperture</string>'
  )

writeFileSync(plistPath, plist, 'utf8')
console.log('patch-electron-dev: patched Info.plist — CFBundleName/DisplayName → Aperture')
