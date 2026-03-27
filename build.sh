#!/bin/bash
# Build script for Railway deployment
# Builds frontend + backend, serves both from NestJS on one port

set -e

export NPM_CONFIG_PRODUCTION=false
export NODE_ENV=development

echo "=== Installing Frontend Dependencies (with dev deps) ==="
npm install --legacy-peer-deps --include=dev

echo "=== Building Frontend ==="
npm run build
# Move frontend build to backend/frontend-dist
rm -rf backend/frontend-dist
mv dist backend/frontend-dist

echo "=== Installing Backend Dependencies (with dev deps) ==="
cd backend
npm install --include=dev

echo "=== Building Backend ==="
npm run build

echo "=== Build Complete ==="
echo "Run: cd backend && npm run start:prod"
