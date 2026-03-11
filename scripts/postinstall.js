/**
 * postinstall.js
 *
 * Runs after `npm install`. Two responsibilities:
 *
 * 1. Save the system-Node DuckDB binary (just downloaded by duckdb's own
 *    install script) as `duckdb-system.node`.  This binary is compiled for
 *    the current system Node.js ABI and is what Vitest needs to run tests.
 *
 * 2. Run electron-rebuild to replace `duckdb.node` with the Electron-ABI
 *    binary.  This is what the Electron app needs at runtime.
 *
 * Result after postinstall:
 *   duckdb.node         ← Electron ABI binary  (used by `just dev` / app)
 *   duckdb-system.node  ← system Node ABI binary (used by `npm test`)
 *
 * In CI (process.env.CI === 'true') we skip electron-rebuild entirely.
 * npm install leaves the system-Node binary in place, which is all tests need.
 */

'use strict'

const { execSync } = require('child_process')
const { copyFileSync, existsSync } = require('fs')
const path = require('path')

if (process.env.CI) {
  console.log('postinstall: CI detected — skipping electron-rebuild')
  process.exit(0)
}

const bindingDir = path.join(__dirname, '..', 'node_modules', 'duckdb', 'lib', 'binding')
const currentBin = path.join(bindingDir, 'duckdb.node')
const systemBin  = path.join(bindingDir, 'duckdb-system.node')

// Save the system-Node binary before electron-rebuild overwrites it.
if (existsSync(currentBin)) {
  copyFileSync(currentBin, systemBin)
  console.log('postinstall: saved system-Node DuckDB binary → duckdb-system.node')
} else {
  console.warn('postinstall: duckdb.node not found before electron-rebuild — tests may fail')
}

// Install the Electron-ABI binary (overwrites duckdb.node).
execSync('npm run rebuild', { stdio: 'inherit' })
console.log('postinstall: Electron DuckDB binary installed → duckdb.node')
