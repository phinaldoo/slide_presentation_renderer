#!/usr/bin/env bash

set -euo pipefail

ENV_FILES=("/app/.env" "/app/config/.env")

load_env_value_from_file() {
  local env_file="$1"
  local env_key="$2"
  python3 - "${env_file}" "${env_key}" <<'PY'
import sys
from pathlib import Path

env_path = Path(sys.argv[1])
target_key = sys.argv[2]
try:
    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in raw_line:
            continue
        key, raw_value = raw_line.split("=", 1)
        if key.strip() != target_key:
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

load_env_key_if_unset() {
  local env_key="$1"
  local env_file=""

  if [[ -n "${!env_key:-}" ]]; then
    return
  fi

  for candidate in "${ENV_FILES[@]}"; do
    if [[ -f "${candidate}" ]]; then
      env_file="${candidate}"
      break
    fi
  done

  if [[ -z "${env_file}" ]]; then
    echo "[entrypoint] ${env_key} is unset and no env file was found at: ${ENV_FILES[*]}" >&2
    return
  fi

  local value_from_file
  value_from_file="$(load_env_value_from_file "${env_file}" "${env_key}")"

  if [[ -n "${value_from_file}" ]]; then
    export "${env_key}=${value_from_file}"
    echo "[entrypoint] Loaded ${env_key} from ${env_file}" >&2
  else
    if grep -qE "^${env_key}=" "${env_file}"; then
      echo "[entrypoint] ${env_key} is present in ${env_file} but empty" >&2
    else
      echo "[entrypoint] ${env_key} is unset and not present in ${env_file}" >&2
    fi
  fi
}

load_env_key_if_unset "API_KEYS"
load_env_key_if_unset "DEVELOPMENT_MODE"
load_env_key_if_unset "ENABLE_DOCS"

exec "$@"
