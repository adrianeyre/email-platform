#!/bin/sh
# Deploys the commit at the tip of main to the stack on this server: pull,
# build the images, migrate, restart, check /health. Run it on the server, in
# the checkout that holds .env: `sh ops/deploy-server.sh`.
#
# The host builds and runs only the images. It installs no npm package and
# runs no typecheck, lint or test, so no development dependency ever runs
# here beside .env and the Docker daemon (#178); those checks run on every
# pull request before it can reach main (.github/workflows/checks.yml). The
# checkout must be main itself, with nothing of its own on top, so what is
# deployed is what was merged. Needs git, docker (with Compose) and curl.
set -eu

health_url="${DEPLOY_HEALTH_URL:-http://127.0.0.1:4320/health}"

fail() {
  echo "deploy.failed step=$1: the running stack was left as it was" >&2
  exit 1
}

echo "deploy.step pull"
git pull --ff-only origin main || fail pull
head="$(git rev-parse HEAD)" || fail pull
main="$(git rev-parse origin/main)" || fail pull
if [ "$head" != "$main" ]; then
  echo "deploy.failed step=pull: HEAD ($head) is not origin/main ($main); deploy main itself, with no local commits" >&2
  exit 1
fi
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
