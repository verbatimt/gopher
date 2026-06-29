# Gopher web image: the pre-built Flutter web bundle served by nginx (same-origin proxy).
# Built from a small staging context (see scripts/deploy.sh): `web/` (the build output) and
# `nginx.conf`. Targets linux/arm64 (server.local).

FROM nginx:alpine

RUN apk add --no-cache curl

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY web /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:80/ > /dev/null || exit 1
