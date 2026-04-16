# Aperture — developer task runner
# Install: brew install just
# Usage:   just <recipe>   |   just --list

# Default: print available recipes
default:
    @just --list

# ── Dependencies ──────────────────────────────────────────────────────────────

# Install npm dependencies
install:
    npm ci

# ── Development ───────────────────────────────────────────────────────────────

# Start Electron app in development mode (hot-reload enabled)
dev:
    npm run dev

# ── Quality Gates ─────────────────────────────────────────────────────────────

# Type-check all processes (main + renderer)
typecheck:
    npm run typecheck

# Run all unit tests once
test:
    npm test

# Run tests in watch mode (re-runs on file changes)
test-watch:
    npm run test:watch

# Run tests with coverage report and enforce 70 % minimum
coverage:
    npm run test:coverage

# Open the HTML coverage report in the browser (run `just coverage` first)
coverage-open:
    open coverage/index.html

# Alias: typecheck is the static-analysis gate until ESLint is wired in
lint:
    @just typecheck

# Run the full local CI suite (lint + typecheck + tests + coverage) — mirrors CI pipeline
ci:
    @just lint
    @just coverage
    @echo "✓ All CI checks passed"

# ── Build & Release ───────────────────────────────────────────────────────────

# Compile main + preload + renderer (outputs to out/)
build:
    npm run build

# Build a DMG for the current machine's arch only — fast local smoke test (~30s)
# Use this while developing; CI builds both arm64 + x64 on tag push.
release-local:
    #!/usr/bin/env bash
    ARCH=$(uname -m | sed 's/x86_64/x64/;s/arm64/arm64/')
    echo "Building for $ARCH only…"
    npm run build && npx electron-builder --mac --$ARCH

# Build DMGs for BOTH arm64 and x64 — mirrors the CI release job (~5 min)
release:
    npm run build:mac

# Build (native arch only) and immediately open the dist/ folder in Finder
release-open: release-local
    open dist/

# ── Versioning ────────────────────────────────────────────────────────────────

# Print current version from package.json
version:
    @node -p "require('./package.json').version"

# Bump version without committing (level: patch | minor | major)
bump level='patch':
    npm version {{level}} --no-git-tag-version
    @echo "✓ Bumped to v$(just version)"

# Tag the current commit and push — triggers the Release CI workflow
tag-release:
    #!/usr/bin/env bash
    set -euo pipefail
    VERSION="v$(just version)"
    echo "Tagging $VERSION …"
    git add package.json package-lock.json
    git commit -m "chore: release $VERSION" || true
    git tag "$VERSION"
    git push origin HEAD
    git push origin "$VERSION"
    echo "✓ $VERSION pushed — GitHub Actions will build the DMG"

# ── Branching ─────────────────────────────────────────────────────────────────
# All changes must be made on a branch, never directly on main.

# Create a new feature branch from the latest main (e.g. just branch feat/my-thing)
branch name:
    git checkout master
    git pull origin master
    git checkout -b {{name}}
    @echo "✓ Created branch '{{name}}' from master"

# Push the current branch and open a PR (requires gh CLI)
pr title='':
    #!/usr/bin/env bash
    set -euo pipefail
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if [[ "$BRANCH" == "master" ]]; then
        echo "❌  You're on master. Create a branch first: just branch feat/my-thing"
        exit 1
    fi
    git push -u origin "$BRANCH"
    if command -v gh &>/dev/null; then
        gh pr create --fill --web
    else
        echo "✓ Branch pushed. Open a PR at: https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo '<org>/<repo>')/compare/$BRANCH"
    fi

# ── Housekeeping ──────────────────────────────────────────────────────────────

# Remove all build artifacts (out/, dist/)
clean:
    rm -rf out dist

# Remove build artifacts AND node_modules (full reset)
clean-all:
    rm -rf out dist node_modules

# Run the headless Docker CI environment (typecheck + tests, no Electron GUI)
docker-ci:
    docker compose up --abort-on-container-exit --exit-code-from test

# Print a quick project status summary
status:
    @echo "── Aperture $(just version) ──────────────────"
    @echo "Branch : $(git rev-parse --abbrev-ref HEAD)"
    @echo "Commit : $(git log -1 --format='%h %s')"
    @echo "Node   : $(node --version)"
    @echo "npm    : $(npm --version)"
