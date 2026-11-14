#!/usr/bin/env bash
# Build the app and its Docker image on a given Node version the way the release workflow does
# (host build, node_modules ADDed into the image), then run the e2e suite against the container.
#
# Usage: e2e/scripts/test-image.sh [NODE_VERSION] [playwright args...]
#   no NODE_VERSION (or ""): image exactly as the Dockerfile builds it (what ships today)
#   NODE_VERSION=24:         --build-arg NODE_VERSION=24, and fail unless the image really runs Node 24
# Build with the matching host Node first (nvm use <version>; CI uses actions/setup-node).
set -euo pipefail

NODE_VERSION="${1:-}"
shift || true
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="sdk-app:e2e${NODE_VERSION:+-node$NODE_VERSION}"

echo "Host Node (build): $(node -v)"
cd "$ROOT"
npm run build
docker build ${NODE_VERSION:+--build-arg NODE_VERSION="$NODE_VERSION"} -t "$IMAGE" .

# The Dockerfile must honour NODE_VERSION; a hardcoded base tag would silently test the wrong Node.
IMAGE_NODE="$(docker run --rm --entrypoint node "$IMAGE" -v)"
echo "Image Node (runtime): $IMAGE_NODE"
if [[ -n "$NODE_VERSION" && "$IMAGE_NODE" != "v${NODE_VERSION}"* ]]; then
  echo "Image runs $IMAGE_NODE, expected Node $NODE_VERSION. Does the Dockerfile use ARG NODE_VERSION?" >&2
  exit 1
fi

# Playwright stops `docker run` but not always the container; clear it before and after the run.
cleanup() { docker rm -f sdk-app-e2e >/dev/null 2>&1 || true; }
cleanup
trap cleanup EXIT

cd e2e
E2E_APP_IMAGE="$IMAGE" npx playwright test "$@"
