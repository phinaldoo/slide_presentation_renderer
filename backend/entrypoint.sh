#!/usr/bin/env bash

set -euo pipefail

ENV_FILE="/app/.env"

load_api_keys_from_file() {
  python3 <<'PY'
from pathlib import Path

env_path = Path("/app/.env")
try:
    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in raw_line:
            continue
        key, raw_value = raw_line.split("=", 1)
        if key.strip() != "API_KEYS":
            continue
        value = raw_value.strip()
        if value and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        print(value)
        break
except FileNotFoundError:
    pass
PY
}

if [[ -z "${API_KEYS:-}" ]]; then
  if [[ -f "${ENV_FILE}" ]]; then
    API_KEYS_FROM_FILE="$(load_api_keys_from_file)"
    if [[ -n "${API_KEYS_FROM_FILE}" ]]; then
      export API_KEYS="${API_KEYS_FROM_FILE}"
      echo "[entrypoint] Loaded API_KEYS from ${ENV_FILE}" >&2
    else
      echo "[entrypoint] API_KEYS is unset and not present in ${ENV_FILE}" >&2
    fi
  else
    echo "[entrypoint] API_KEYS is unset and ${ENV_FILE} does not exist" >&2
  fi
fi

exec "$@"
