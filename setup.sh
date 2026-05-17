#!/usr/bin/env bash
set -euo pipefail

EXAMPLE_ENV=".env.example"
TARGET_ENV=".env"

printf 'Setting up slide presentation renderer configuration...\n\n'

mkdir -p certs

generate_api_key() {
  local python_cmd
  local api_key

  for python_cmd in python3 python; do
    if command -v "$python_cmd" >/dev/null 2>&1; then
      if api_key="$("$python_cmd" - <<'PY' 2>/dev/null
import secrets

print(secrets.token_urlsafe(48))
PY
      )"; then
        printf '%s\n' "$api_key"
        return 0
      fi
    fi
  done

  if command -v py >/dev/null 2>&1; then
    if api_key="$(py -3 - <<'PY' 2>/dev/null
import secrets

print(secrets.token_urlsafe(48))
PY
    )"; then
      printf '%s\n' "$api_key"
      return 0
    fi
  fi

  printf 'Python is required to generate API_KEYS. Install Python 3 and retry.\n' >&2
  return 1
}

escape_sed_replacement() {
  local value="$1"
  value=${value//\\/\\\\}
  value=${value//&/\\&}
  value=${value//|/\\|}
  printf '%s' "$value"
}

sed_in_place() {
  local file="$1"
  local expression="$2"
  local tmp
  tmp="$(mktemp "${file}.XXXXXX")"

  trap 'rm -f "$tmp"' RETURN
  sed "$expression" "$file" >"$tmp"
  mv "$tmp" "$file"
  trap - RETURN
}

sync_env_with_example() {
  local example_file="$1"
  local target_file="$2"
  local added=0
  local appended_any=0

  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|'#'*) continue ;;
    esac

    if [[ "$line" != *'='* ]]; then
      continue
    fi

    local key="${line%%=*}"
    key="${key%%[[:space:]]*}"
    key="${key##[[:space:]]*}"

    if [ -z "$key" ]; then
      continue
    fi

    if ! grep -Fq "${key}=" "$target_file"; then
      if [ "$appended_any" -eq 0 ]; then
        if [ -s "$target_file" ] && [ "$(tail -c1 "$target_file" 2>/dev/null || true)" != $'\n' ]; then
          printf '\n' >>"$target_file"
        fi
        appended_any=1
      fi
      printf '%s\n' "$line" >>"$target_file"
      added=$((added + 1))
    fi
  done <"$example_file"

  if [ "$added" -gt 0 ]; then
    printf 'Added %d new key(s) from %s into %s\n' "$added" "$example_file" "$target_file"
  else
    printf '%s already contains all keys from %s\n' "$target_file" "$example_file"
  fi
}

ensure_api_keys() {
  local env_file="$1"
  local current_value=""

  if grep -q '^API_KEYS=' "$env_file"; then
    current_value="$(grep -m1 '^API_KEYS=' "$env_file" | sed 's/^API_KEYS=//')"
    current_value="${current_value%\"}"
    current_value="${current_value#\"}"
    current_value="${current_value%\'}"
    current_value="${current_value#\'}"
  else
    printf 'API_KEYS=\n' >>"$env_file"
  fi

  local normalized_value
  normalized_value="$(printf '%s' "$current_value" | tr '[:upper:]' '[:lower:]')"

  case "$normalized_value" in
    ''|changeme|default|change-me-with-a-long-random-key|replace-with-a-long-random-api-key)
      ;;
    *)
      if [ "${#current_value}" -ge 16 ]; then
        printf 'API_KEYS already configured\n'
        return 0
      fi
      ;;
  esac

  local api_key
  api_key="$(generate_api_key)"
  if [ -z "$api_key" ]; then
    printf 'Failed to generate API_KEYS\n' >&2
    return 1
  fi

  api_key="$(escape_sed_replacement "$api_key")"
  sed_in_place "$env_file" "s|^API_KEYS=.*|API_KEYS=${api_key}|"
  printf 'Generated API_KEYS\n'
}

if [ ! -f "$EXAMPLE_ENV" ]; then
  printf 'Missing %s; cannot create setup configuration.\n' "$EXAMPLE_ENV" >&2
  exit 1
fi

if [ ! -f "$TARGET_ENV" ]; then
  cp "$EXAMPLE_ENV" "$TARGET_ENV"
  printf 'Created %s from %s\n' "$TARGET_ENV" "$EXAMPLE_ENV"
else
  printf '%s already exists; syncing new keys from %s\n' "$TARGET_ENV" "$EXAMPLE_ENV"
  sync_env_with_example "$EXAMPLE_ENV" "$TARGET_ENV"
fi

ensure_api_keys "$TARGET_ENV"

cat <<'EONEXT'

Setup complete.

Next steps:
  1. Review .env if you want to adjust ports, HTTPS, or production hardening.
  2. Start the renderer: make up
  3. Check status: make ps
EONEXT
