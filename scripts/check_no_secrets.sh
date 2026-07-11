#!/usr/bin/env bash
set -euo pipefail

patterns=(
  'CLOUDFLARE_API_TOKEN=' 
  'BEGIN PRIVATE KEY'
  'GLOBAL_API_KEY'
  'VAPID_PRIVATE_KEY='
)

for pattern in "${patterns[@]}"; do
  if grep -RIn --exclude-dir=.git --exclude-dir=node_modules --exclude='check_no_secrets.sh' "$pattern" .; then
    echo "Potential secret pattern found: $pattern" >&2
    exit 1
  fi
done

echo "No obvious committed secret patterns found."
