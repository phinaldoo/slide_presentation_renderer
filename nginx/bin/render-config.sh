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

MAX_REQUEST_BODY_BYTES="${MAX_REQUEST_BODY_BYTES:-180000000}"
RENDER_TIMEOUT_SECONDS="${RENDER_TIMEOUT_SECONDS:-180}"

if ! validate_uint "${MAX_REQUEST_BODY_BYTES}" || [ "${MAX_REQUEST_BODY_BYTES}" -lt 1024 ]; then
  echo "[render-config] MAX_REQUEST_BODY_BYTES must be an integer >= 1024" >&2
  exit 1
fi

if ! validate_uint "${RENDER_TIMEOUT_SECONDS}" || [ "${RENDER_TIMEOUT_SECONDS}" -lt 5 ]; then
  echo "[render-config] RENDER_TIMEOUT_SECONDS must be an integer >= 5" >&2
  exit 1
fi

UPSTREAM_TIMEOUT_SECONDS=$((RENDER_TIMEOUT_SECONDS + 15))

mkdir -p "$(dirname "${OUTPUT_PATH}")"

sed \
  -e "s/__CLIENT_MAX_BODY_SIZE__/${MAX_REQUEST_BODY_BYTES}/g" \
  -e "s/__UPSTREAM_TIMEOUT_SECONDS__/${UPSTREAM_TIMEOUT_SECONDS}/g" \
  "${TEMPLATE_PATH}" > "${OUTPUT_PATH}"

echo "[render-config] Generated nginx config with client_max_body_size=${MAX_REQUEST_BODY_BYTES} upstream_timeout=${UPSTREAM_TIMEOUT_SECONDS}s"
