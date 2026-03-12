/**
 * notarize.js
 *
 * electron-builder afterSign hook — submits the signed .app to Apple's
 * notarization service using xcrun notarytool (macOS 13+).
 *
 * Runs automatically after code-signing when called from electron-builder via
 * the "afterSign" option in electron-builder.yml.
 *
 * Skips silently if any of the three required environment variables are absent,
 * so unsigned/local builds continue to work without credentials.
 *
 * Required environment variables (set as GitHub Actions secrets):
 *   APPLE_ID                   — your Apple ID email
 *   APPLE_APP_SPECIFIC_PASSWORD — app-specific password from appleid.apple.com
 *   APPLE_TEAM_ID              — 10-character Team ID from developer.apple.com
 */

'use strict'

const path = require('path')

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context

  // Only runs on macOS builds.
  if (electronPlatformName !== 'darwin') return

  const appleId       = process.env.APPLE_ID
  const appleIdPass   = process.env.APPLE_APP_SPECIFIC_PASSWORD
  const teamId        = process.env.APPLE_TEAM_ID

  // Skip gracefully when credentials are not configured (unsigned local builds).
  if (!appleId || !appleIdPass || !teamId) {
    console.log('notarize: skipping — APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set')
    return
  }

  // Lazy-load @electron/notarize so the build doesn't fail when it isn't installed.
  let notarize
  try {
    ;({ notarize } = require('@electron/notarize'))
  } catch {
    console.warn('notarize: @electron/notarize not installed — skipping notarization')
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(appOutDir, `${appName}.app`)

  console.log(`notarize: submitting ${appName}.app to Apple notarization service…`)

  await notarize({
    appPath,
    appleId,
    appleIdPassword: appleIdPass,
    teamId,
  })

  console.log(`notarize: ✓ ${appName}.app notarized successfully`)
}
