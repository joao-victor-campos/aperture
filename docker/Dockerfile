# Aperture — headless CI / dev environment
# NOTE: Electron GUI cannot run in Docker. This image is for:
#   - Running tests (vitest)
#   - Type-checking
#   - Building the renderer and main process bundles (no .app packaging)
# macOS .app packaging must be done on the host via: npm run build:mac

FROM node:22-slim

# Build tools required by DuckDB's native Node.js bindings
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (cached layer)
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Default: run tests
CMD ["npm", "test"]
