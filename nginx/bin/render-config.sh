#!/usr/bin/env sh
set -eu

TEMPLATE_PATH="${TEMPLATE_PATH:-/opt/renderer/renderer.conf.template}"
OUTPUT_PATH="${OUTPUT_PATH:-/etc/nginx/conf.d/default.conf}"

validate_uint() {
  case "$1" in
    ''|*[!0-9]*)
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

MAX_REQUEST_BODY_BYTES="${MAX_REQUEST_BODY_BYTES:-180000000}"
RENDER_TIMEOUT_SECONDS="${RENDER_TIMEOUT_SECONDS:-180}"
FRONTEND_USE_HTTPS="$(lower "${FRONTEND_USE_HTTPS:-false}")"
FRONTEND_SSL_CERT_PATH="${FRONTEND_SSL_CERT_PATH:-/certs/fullchain.pem}"
FRONTEND_SSL_KEY_PATH="${FRONTEND_SSL_KEY_PATH:-/certs/privkey.pem}"
FRONTEND_SSL_CHAIN_PATH="${FRONTEND_SSL_CHAIN_PATH:-}"

if ! validate_uint "${MAX_REQUEST_BODY_BYTES}" || [ "${MAX_REQUEST_BODY_BYTES}" -lt 1024 ]; then
  echo "[render-config] MAX_REQUEST_BODY_BYTES must be an integer >= 1024" >&2
  exit 1
fi

if ! validate_uint "${RENDER_TIMEOUT_SECONDS}" || [ "${RENDER_TIMEOUT_SECONDS}" -lt 5 ]; then
  echo "[render-config] RENDER_TIMEOUT_SECONDS must be an integer >= 5" >&2
  exit 1
fi

if [ "${FRONTEND_USE_HTTPS}" != "true" ] && [ "${FRONTEND_USE_HTTPS}" != "false" ]; then
  echo "[render-config] FRONTEND_USE_HTTPS must be true or false" >&2
  exit 1
fi

if [ "${FRONTEND_USE_HTTPS}" = "true" ]; then
  if [ ! -f "${FRONTEND_SSL_CERT_PATH}" ]; then
    echo "[render-config] FRONTEND_SSL_CERT_PATH file not found at ${FRONTEND_SSL_CERT_PATH}" >&2
    exit 1
  fi

  if [ ! -f "${FRONTEND_SSL_KEY_PATH}" ]; then
    echo "[render-config] FRONTEND_SSL_KEY_PATH file not found at ${FRONTEND_SSL_KEY_PATH}" >&2
    exit 1
  fi

  if [ -n "${FRONTEND_SSL_CHAIN_PATH}" ] && [ ! -f "${FRONTEND_SSL_CHAIN_PATH}" ]; then
    echo "[render-config] FRONTEND_SSL_CHAIN_PATH file not found at ${FRONTEND_SSL_CHAIN_PATH}" >&2
    exit 1
  fi
fi

UPSTREAM_TIMEOUT_SECONDS=$((RENDER_TIMEOUT_SECONDS + 15))

mkdir -p "$(dirname "${OUTPUT_PATH}")"

if [ "${FRONTEND_USE_HTTPS}" = "true" ]; then
  LISTEN_BLOCK='    listen 8080 ssl;
    http2 on;'
  SSL_BLOCK="    ssl_certificate ${FRONTEND_SSL_CERT_PATH};
    ssl_certificate_key ${FRONTEND_SSL_KEY_PATH};"
  if [ -n "${FRONTEND_SSL_CHAIN_PATH}" ]; then
    SSL_BLOCK="${SSL_BLOCK}
    ssl_trusted_certificate ${FRONTEND_SSL_CHAIN_PATH};"
  fi
  SSL_BLOCK="${SSL_BLOCK}
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305';
    ssl_prefer_server_ciphers off;"
  HSTS_HEADER='    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;'
else
  LISTEN_BLOCK='    listen 8080;'
  SSL_BLOCK=''
  HSTS_HEADER=''
fi

awk \
  -v client_max_body_size="${MAX_REQUEST_BODY_BYTES}" \
  -v upstream_timeout_seconds="${UPSTREAM_TIMEOUT_SECONDS}" \
  -v listen_block="${LISTEN_BLOCK}" \
  -v ssl_block="${SSL_BLOCK}" \
  -v hsts_header="${HSTS_HEADER}" \
  '
  {
    if ($0 == "__LISTEN_BLOCK__") {
      print listen_block
      next
    }
    if ($0 == "__SSL_BLOCK__") {
      if (ssl_block != "") {
        print ssl_block
      }
      next
    }
    if ($0 == "__HSTS_HEADER__") {
      if (hsts_header != "") {
        print hsts_header
      }
      next
    }

    gsub("__CLIENT_MAX_BODY_SIZE__", client_max_body_size)
    gsub("__UPSTREAM_TIMEOUT_SECONDS__", upstream_timeout_seconds)
    print
  }
  ' "${TEMPLATE_PATH}" > "${OUTPUT_PATH}"

echo "[render-config] Generated nginx config with client_max_body_size=${MAX_REQUEST_BODY_BYTES} upstream_timeout=${UPSTREAM_TIMEOUT_SECONDS}s https=${FRONTEND_USE_HTTPS}"
