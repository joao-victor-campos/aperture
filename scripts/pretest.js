/**
 * pretest.js
 *
 * Runs automatically before `npm test` (via the "pretest" npm lifecycle hook).
 *
 * Swaps the DuckDB binary to the system-Node ABI version so that Vitest
 * (which runs under the system Node.js runtime, not Electron) can load the
 * native module.
 *
 * Steps:
 *   1. Back up the current binary (usually the Electron ABI binary) as
 *      `duckdb-electron.node` so `posttest` can restore it.
 *   2. Copy `duckdb-system.node` → `duckdb.node`.
 *
 * If `duckdb-system.node` does not exist (e.g. first run in CI where
 * electron-rebuild was never called), the script exits without touching
 * anything — the binary left by `npm install` is already the system-Node one.
 */

'use strict'

const { copyFileSync, existsSync } = require('fs')
const path = require('path')

const bindingDir  = path.join(__dirname, '..', 'node_modules', 'duckdb', 'lib', 'binding')
const currentBin  = path.join(bindingDir, 'duckdb.node')
const systemBin   = path.join(bindingDir, 'duckdb-system.node')
const electronBin = path.join(bindingDir, 'duckdb-electron.node')

if (!existsSync(systemBin)) {
  // CI or first install without electron-rebuild: current binary is already
  // the system-Node one. Nothing to do.
  process.exit(0)
}

// Back up the Electron binary so posttest can restore it.
if (existsSync(currentBin)) {
  copyFileSync(currentBin, electronBin)
}

// Activate the system-Node binary for the test run.
copyFileSync(systemBin, currentBin)
console.log('pretest: switched DuckDB binary → system-Node ABI (for Vitest)')
