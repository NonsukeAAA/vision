#!/usr/bin/env bash
# Link + push vision schema to the hosted Supabase project.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REF="${SUPABASE_PROJECT_ID:-nmdlasnxevejggwmnjwm}"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "SUPABASE_ACCESS_TOKEN is required."
  echo "Create one at https://supabase.com/dashboard/account/tokens"
  echo "Then: export SUPABASE_ACCESS_TOKEN=... && ./scripts/supabase-link.sh"
  exit 1
fi

npx --yes supabase link --project-ref "$REF"
npx --yes supabase db push
echo "Linked and migrated: $REF"
echo "Enable Authentication → Providers → Anonymous Sign-Ins in the Dashboard."
