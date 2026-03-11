/**
 * posttest.js
 *
 * Runs automatically after `npm test` (via the "posttest" npm lifecycle hook).
 *
 * Restores the Electron-ABI DuckDB binary so that `just dev` continues to
 * work immediately after running tests without requiring a manual rebuild.
 *
 * If the backup created by pretest.js (`duckdb-electron.node`) does not exist
 * (CI, or first run without electron-rebuild), the script exits without
 * touching anything.
 */

'use strict'

const { copyFileSync, existsSync } = require('fs')
const path = require('path')

const bindingDir  = path.join(__dirname, '..', 'node_modules', 'duckdb', 'lib', 'binding')
const currentBin  = path.join(bindingDir, 'duckdb.node')
const electronBin = path.join(bindingDir, 'duckdb-electron.node')

if (!existsSync(electronBin)) {
  // No Electron binary backup found (CI or no electron-rebuild run yet). Nothing to restore.
  process.exit(0)
}

copyFileSync(electronBin, currentBin)
console.log('posttest: restored DuckDB binary → Electron ABI (for just dev)')
