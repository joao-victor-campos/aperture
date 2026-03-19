/**
 * postinstall.js
 *
 * Runs after `npm install`. Two responsibilities:
 *
 * 1. Save the system-Node DuckDB binary (just downloaded by duckdb's own
 *    install script) as `duckdb-system.node`.  This binary is compiled for
 *    the current system Node.js ABI and is what Vitest needs to run tests.
 *
 * 2. Download the Electron-ABI DuckDB binary directly from the DuckDB CDN.
 *    electron-rebuild fails for DuckDB >=1.4 (no pre-built, source compile
 *    breaks), so we download the correct pre-built binary by computing the
 *    Electron Node ABI version ourselves.
 *
 * Result after postinstall:
 *   duckdb.node         ← Electron ABI binary  (used by `just dev` / app)
 *   duckdb-system.node  ← system Node ABI binary (used by `npm test`)
 *
 * In CI (process.env.CI === 'true') we skip the Electron binary entirely.
 * npm install leaves the system-Node binary in place, which is all tests need.
 */

'use strict'

const { execSync } = require('child_process')
const { copyFileSync, existsSync, mkdirSync } = require('fs')
const path = require('path')

if (process.env.CI) {
  console.log('postinstall: CI detected — skipping Electron binary download')
  process.exit(0)
}

const bindingDir = path.join(__dirname, '..', 'node_modules', 'duckdb', 'lib', 'binding')
const currentBin = path.join(bindingDir, 'duckdb.node')
const systemBin  = path.join(bindingDir, 'duckdb-system.node')

mkdirSync(bindingDir, { recursive: true })

// Save the system-Node binary before we overwrite it.
if (existsSync(currentBin)) {
  copyFileSync(currentBin, systemBin)
  console.log('postinstall: saved system-Node DuckDB binary → duckdb-system.node')
} else {
  console.warn('postinstall: duckdb.node not found — downloading system binary first')
  try {
    execSync(
      'node node_modules/.bin/node-pre-gyp install --directory node_modules/duckdb --fallback-to-build',
      { stdio: 'inherit', cwd: path.join(__dirname, '..') }
    )
    if (existsSync(currentBin)) {
      copyFileSync(currentBin, systemBin)
      console.log('postinstall: downloaded and saved system-Node binary → duckdb-system.node')
    }
  } catch (e) {
    console.warn('postinstall: failed to download system binary — tests may fail')
  }
}

// Download the Electron-ABI binary directly from DuckDB CDN.
// electron-rebuild fails for DuckDB >=1.4, so we fetch it ourselves.
const duckdbPkg = require(path.join(__dirname, '..', 'node_modules', 'duckdb', 'package.json'))
const electronPkg = require(path.join(__dirname, '..', 'node_modules', 'electron', 'package.json'))
const duckdbVersion = duckdbPkg.version

// Map Electron major version → Node ABI version
// Electron 33 = Node 20 = ABI 115, Electron 34 = Node 20 = ABI 115
const electronMajor = parseInt(electronPkg.version.split('.')[0], 10)
const electronAbiMap = { 31: 115, 32: 115, 33: 115, 34: 115, 35: 121 }
const abi = electronAbiMap[electronMajor] || 115

// Always use the NATIVE machine architecture, not process.arch.
// process.arch can return 'x64' when Node runs under Rosetta on Apple Silicon,
// which would cause us to download the wrong (x86_64) binary.
const nativeMachine = execSync('uname -m').toString().trim()
const arch = nativeMachine === 'x86_64' ? 'x64' : 'arm64'
const url = `https://npm.duckdb.org/duckdb/duckdb-v${duckdbVersion}-node-v${abi}-darwin-${arch}.tar.gz`

console.log(`postinstall: downloading Electron ABI binary (ABI ${abi}, ${arch})`)
console.log(`postinstall: ${url}`)

const electronBin = path.join(bindingDir, 'duckdb-electron.node')

try {
  execSync(
    `curl -sL "${url}" | tar xz -C "${path.join(__dirname, '..', 'node_modules', 'duckdb', 'lib')}"`,
    { stdio: 'inherit' }
  )
  // Save a pristine copy of the Electron binary so posttest.js can always
  // restore the correct one, even if something overwrites duckdb.node later.
  if (existsSync(currentBin)) {
    copyFileSync(currentBin, electronBin)
  }
  console.log('postinstall: Electron DuckDB binary installed → duckdb.node + duckdb-electron.node')
} catch (e) {
  console.error('postinstall: failed to download Electron binary. Run `just rebuild` manually.')
  process.exit(1)
}

// Patch the Electron bundle icon + name for dev mode
try {
  require('./patch-electron-dev.js')
} catch {
  // non-fatal — just means dev icon won't update until next `just dev`
}
