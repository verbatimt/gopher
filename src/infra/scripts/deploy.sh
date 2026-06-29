#!/usr/bin/env bash
# src/infra/scripts/deploy.sh
#
# Build the Gopher API + web images locally (linux/arm64), ship them to
# server.local, and (re)start the production stack on the shared LAN macvlan.
# Mirrors the Loom deploy posture: local build → transfer → load → compose up.
# Does not touch any other compose project on the host (project name `gopher`).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
REMOTE_HOST="${REMOTE_HOST:-server.local}"
REMOTE_USER="${REMOTE_USER:-ttaber}"
REMOTE_DIR="/home/${REMOTE_USER}/gopher"
PLATFORM="${PLATFORM:-linux/arm64}"
# Same-origin: the browser (and native clients) talk only to gopher.local; nginx proxies
# /api and /ws to the API.
API_BASE_URL="${API_BASE_URL:-http://gopher.local}"
MACVLAN_NET="${MACVLAN_NET:-everyapp_macvlan}"

export PATH="$HOME/flutter/bin:$PATH"

ENV_FILE="${REPO_ROOT}/src/infra/.env"
if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: ${ENV_FILE} not found. Copy src/infra/.env.prod.example and edit it." >&2
  exit 1
fi

echo "==> Building Gopher API image (${PLATFORM})"
docker build \
  --platform "${PLATFORM}" \
  --file "${REPO_ROOT}/src/server/Dockerfile" \
  --tag gopher-api:latest \
  "${REPO_ROOT}/src/server"

echo "==> Building Flutter web bundle (API_BASE_URL=${API_BASE_URL})"
( cd "${REPO_ROOT}/src/client" && flutter build web --release --dart-define="API_BASE_URL=${API_BASE_URL}" )

echo "==> Building Gopher web image (${PLATFORM})"
WEB_CTX="$(mktemp -d)"
cp -r "${REPO_ROOT}/src/client/build/web" "${WEB_CTX}/web"
cp "${REPO_ROOT}/src/infra/docker/nginx.conf" "${WEB_CTX}/nginx.conf"
docker build \
  --platform "${PLATFORM}" \
  --file "${REPO_ROOT}/src/infra/docker/web.Dockerfile" \
  --tag gopher-web:latest \
  "${WEB_CTX}"
rm -rf "${WEB_CTX}"

echo "==> Saving images to tarballs"
docker save gopher-api:latest | gzip > /tmp/gopher-api.tar.gz
docker save gopher-web:latest | gzip > /tmp/gopher-web.tar.gz

echo "==> Transferring to ${REMOTE_HOST}"
ssh "${REMOTE_USER}@${REMOTE_HOST}" "mkdir -p ${REMOTE_DIR}"
scp /tmp/gopher-api.tar.gz                            "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"
scp /tmp/gopher-web.tar.gz                            "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"
scp "${REPO_ROOT}/src/infra/docker-compose.prod.yml"  "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"
scp "${ENV_FILE}"                                     "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/.env"

echo "==> Loading images on ${REMOTE_HOST}"
ssh "${REMOTE_USER}@${REMOTE_HOST}" "
  set -e
  gunzip -c ${REMOTE_DIR}/gopher-api.tar.gz | docker load
  gunzip -c ${REMOTE_DIR}/gopher-web.tar.gz | docker load
  rm -f ${REMOTE_DIR}/gopher-api.tar.gz ${REMOTE_DIR}/gopher-web.tar.gz
"

echo "==> Verifying shared macvlan network '${MACVLAN_NET}' on ${REMOTE_HOST}"
ssh "${REMOTE_USER}@${REMOTE_HOST}" "
  docker network inspect ${MACVLAN_NET} >/dev/null 2>&1 || {
    echo 'ERROR: external network ${MACVLAN_NET} does not exist on the host.' >&2; exit 1; }
"

echo "==> Starting Gopher stack on ${REMOTE_HOST}"
ssh "${REMOTE_USER}@${REMOTE_HOST}" "
  set -e
  cd ${REMOTE_DIR}
  docker compose -f docker-compose.prod.yml --env-file .env up -d --remove-orphans
  docker compose -f docker-compose.prod.yml ps
"

echo "==> Applying migrations + seeds (waiting for the API container)"
ssh "${REMOTE_USER}@${REMOTE_HOST}" "
  set -e
  cd ${REMOTE_DIR}
  for i in \$(seq 1 30); do
    if docker compose -f docker-compose.prod.yml exec -T gopher_api true 2>/dev/null; then break; fi
    sleep 2
  done
  docker compose -f docker-compose.prod.yml exec -T gopher_api bun run src/db/migrate.ts
  docker compose -f docker-compose.prod.yml exec -T gopher_api bun run src/db/seed.ts
"

rm -f /tmp/gopher-api.tar.gz /tmp/gopher-web.tar.gz

echo
echo "==> Deployment complete."
echo "    Web:  http://gopher.local/                     (192.168.50.53)"
echo "    API:  http://gopher-api.local:3000/health      (192.168.50.54)"
echo "    via nginx (same-origin): http://gopher.local/api/v1  &  /health"
