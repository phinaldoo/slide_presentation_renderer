#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NGINX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT_ROOT="$(cd "${NGINX_DIR}/.." && pwd)"
DEFAULT_ENV_FILE="${PROJECT_ROOT}/.env"

usage() {
  cat <<'EOF'
Usage: ./nginx/bin/generate-config.sh [ENV_FILE]

Generates /nginx/default.conf from HTTP/HTTPS templates based on configuration values.
If ENV_FILE is omitted, the script loads variables from the project root .env file.
EOF
}

arg="${1-}"
if [ "${arg}" = "-h" ] || [ "${arg}" = "--help" ]; then
  usage
  exit 0
fi

ENV_FILE="${DEFAULT_ENV_FILE}"
if [ -n "${arg}" ]; then
  case "${arg}" in
    /*)
      ENV_FILE="${arg}"
      ;;
    *)
      ENV_FILE="${PROJECT_ROOT}/${arg}"
      ;;
  esac
fi

if [ -f "${ENV_FILE}" ]; then
  # shellcheck disable=SC1090
  set -a
    # Cleanup windows line endings
    # shellcheck disable=SC1091
    .  <(sed 's/\r$//' "${ENV_FILE}")
  set +a
elif [ -n "${arg}" ]; then
  echo "[generate-config] Provided env file '${ENV_FILE}' not found." >&2
  exit 1
fi

lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

USE_HTTPS=$(lower "${FRONTEND_USE_HTTPS:-false}")
OUTPUT_PATH="${NGINX_DIR}/default.conf"
HTTP_TEMPLATE="${NGINX_DIR}/default.http.conf.template/default.conf"
HTTPS_TEMPLATE="${NGINX_DIR}/default.https.conf.template/default.conf"

if [ ! -f "${HTTP_TEMPLATE}" ]; then
  echo "[generate-config] HTTP template missing at ${HTTP_TEMPLATE}" >&2
  exit 1
fi

if [ "${USE_HTTPS}" = "true" ]; then
  if [ ! -f "${HTTPS_TEMPLATE}" ]; then
    echo "[generate-config] HTTPS template missing at ${HTTPS_TEMPLATE}" >&2
    exit 1
  fi

  CERT_PATH="${FRONTEND_SSL_CERT_PATH:-/certs/fullchain.pem}"
  KEY_PATH="${FRONTEND_SSL_KEY_PATH:-/certs/privkey.pem}"
  CHAIN_PATH="${FRONTEND_SSL_CHAIN_PATH:-}" # optional

  python3 - "${HTTPS_TEMPLATE}" "${OUTPUT_PATH}" "${CERT_PATH}" "${KEY_PATH}" "${CHAIN_PATH}" <<'PY'
import sys
from pathlib import Path

TEMPLATE_PATH = Path(sys.argv[1])
OUTPUT_PATH = Path(sys.argv[2])
CERT_PATH = sys.argv[3]
KEY_PATH = sys.argv[4]
CHAIN_PATH = sys.argv[5]

content = TEMPLATE_PATH.read_text()
content = content.replace("__SSL_CERT_PATH__", CERT_PATH)
content = content.replace("__SSL_CERT_KEY_PATH__", KEY_PATH)

if CHAIN_PATH:
    trusted_line = f"    ssl_trusted_certificate {CHAIN_PATH};"
else:
    trusted_line = "    # ssl_trusted_certificate not set (optional)"

content = content.replace("__SSL_TRUSTED_CERT_LINE__", trusted_line)
OUTPUT_PATH.write_text(content)
PY

  echo "[generate-config] Generated HTTPS nginx config at ${OUTPUT_PATH}"
else
  cp "${HTTP_TEMPLATE}" "${OUTPUT_PATH}"
  echo "[generate-config] Generated HTTP nginx config at ${OUTPUT_PATH}"
fi
