#!/bin/sh
set -eu

health_url="${DEPLOY_HEALTH_URL:-http://127.0.0.1:4320/health}"

fail() {
  echo "deploy.failed step=$1: the running stack was left as it was" >&2
  exit 1
}

echo "deploy.step pull"
git pull --ff-only || fail pull
echo "deploy.step install"
pnpm install --frozen-lockfile || fail install
echo "deploy.step check"
pnpm run typecheck || fail typecheck
pnpm run lint || fail lint
pnpm test || fail test
echo "deploy.step build-images"
docker compose build || fail build-images
echo "deploy.step migrate"
docker compose run --rm migrate || fail migrate
echo "deploy.step restart"
docker compose up -d --wait || {
  echo "deploy.failed step=restart: check docker compose ps" >&2
  exit 1
}
echo "deploy.step health"
curl --fail --silent --show-error --retry 5 --retry-delay 2 --retry-all-errors "$health_url" || {
  echo "deploy.failed step=health: $health_url is not returning 200" >&2
  exit 1
}
echo "deploy.finished"
