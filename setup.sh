#!/usr/bin/env bash
set -euo pipefail

find_example_env() {
  local candidates=(".env.example" "config.example/.env")
  for candidate in "${candidates[@]}"; do
    if [ -f "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
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
          printf '\n' >> "$target_file"
        fi
        appended_any=1
      fi
      printf '%s\n' "$line" >> "$target_file"
      added=$((added + 1))
    fi
  done < "$example_file"

  if [ "$added" -gt 0 ]; then
    printf 'Added %d new key(s) from %s into %s\n' "$added" "$example_file" "$target_file"
  else
    printf '%s already contains all keys from %s\n' "$target_file" "$example_file"
  fi
}

ensure_api_keys() {
  local env_file="$1"
  python3 - "$env_file" <<'PY'
from __future__ import annotations

import secrets
import sys
from pathlib import Path

env_path = Path(sys.argv[1])
lines = env_path.read_text(encoding="utf-8").splitlines()
generated = secrets.token_urlsafe(48)
disallowed = {
    "",
    "change-me-with-a-long-random-key",
    "replace-with-a-long-random-api-key",
    "changeme",
    "default",
}


def clean_value(raw: str) -> str:
    value = raw.strip()
    if value and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1]
    return value.strip()


def needs_replacement(raw: str) -> bool:
    values = [clean_value(part) for part in raw.split(",")]
    values = [value for value in values if value]
    if not values:
        return True
    if any(len(value) < 16 for value in values):
        return True
    return any(value.lower() in disallowed for value in values)


replaced = False
found = False
output: list[str] = []

for line in lines:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in line:
        output.append(line)
        continue
    key, value = line.split("=", 1)
    if key.strip() != "API_KEYS":
        output.append(line)
        continue

    found = True
    if needs_replacement(value):
        output.append(f"API_KEYS={generated}")
        replaced = True
    else:
        output.append(line)

if not found:
    output.append(f"API_KEYS={generated}")
    replaced = True

env_path.write_text("\n".join(output) + "\n", encoding="utf-8")

if replaced:
    print("Generated API_KEYS")
else:
    print("API_KEYS already configured")
PY
}

printf 'Setting up slide presentation renderer configuration...\n\n'

EXAMPLE_ENV="$(find_example_env || true)"

if [ -z "$EXAMPLE_ENV" ]; then
  if [ -f .env ]; then
    printf 'No example .env found; unable to sync new keys.\n'
  else
    printf 'No example .env found. Please create .env manually.\n'
    exit 1
  fi
else
  if [ ! -f .env ]; then
    cp "$EXAMPLE_ENV" .env
    printf 'Created .env from %s\n' "$EXAMPLE_ENV"
  else
    printf '.env already exists; syncing new keys from %s\n' "$EXAMPLE_ENV"
    sync_env_with_example "$EXAMPLE_ENV" ".env"
  fi
fi

if [ -f .env ]; then
  ensure_api_keys .env
fi

cat <<'EONEXT'

Setup complete.

Next steps:
  1. Review .env if you need custom ports, hosts, or limits.
  2. Start the renderer: make up
  3. Check status: make ps
EONEXT
