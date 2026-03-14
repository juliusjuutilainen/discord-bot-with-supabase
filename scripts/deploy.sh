#!/usr/bin/env bash
# deploy.sh — Deploy Discord bot Edge Functions to Supabase
# Requires: supabase CLI (brew install supabase/tap/supabase), Deno
# Usage: bash scripts/deploy.sh

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

# Load .env if present
if [[ -f ".env" ]]; then
  set -a
  source ".env"
  set +a
fi

# ─── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}[info]${NC}  $*"; }
success() { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC}  $*"; }
fatal()   { echo -e "${RED}[error]${NC} $*"; exit 1; }

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  Supabase Discord Bot — Deploy (macOS/Linux)   ${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ─── Check dependencies ────────────────────────────────────────────────────────
info "Checking dependencies..."

if ! command -v supabase &>/dev/null; then
  fatal "supabase CLI not found. Install with: brew install supabase/tap/supabase"
fi
SUPA_VER=$(supabase --version 2>&1 | head -1)
success "supabase CLI: $SUPA_VER"

if ! command -v curl &>/dev/null; then
  fatal "curl not found. Install with: brew install curl"
fi
success "curl: found"

# ─── Project ref ──────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Project reference${NC}"
echo "  Find it in: Supabase Dashboard → Project Settings → General"
echo "  It is the first part of your project URL, e.g. abcdefghijkl"
echo ""
read -rp "  Enter your Supabase project reference: " PROJECT_REF
if [[ -z "$PROJECT_REF" ]]; then
  PROJECT_REF="${SUPABASE_PROJECT_REF:-${supabase_project_ref:-}}"
fi
[[ -z "$PROJECT_REF" ]] && fatal "Project reference cannot be empty."

# ─── Secrets ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Secrets${NC}"
echo "  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically."
echo "  Leave a value blank to skip setting it (e.g. if you only use one backend)."
echo ""

SECRET_DISCORD_PK="${discord_public_key:-${discord_bot_public_key:-}}"
SECRET_DISCORD_APP_ID="${discord_application_id:-${discord_bot_client_id:-}}"
SECRET_DISCORD_BOT_TOKEN="${discord_bot_token:-}"
SECRET_GEMINI="${gemini_api_key:-}"
SECRET_OPENROUTER="${openrouter_api_key:-}"
SECRET_JINA="${jina_api_key:-}"

if [[ -n "$SECRET_DISCORD_PK" ]]; then
  read -rp "  discord_public_key [from .env, Enter to keep]:      " SECRET_DISCORD_PK_INPUT
  [[ -n "$SECRET_DISCORD_PK_INPUT" ]] && SECRET_DISCORD_PK="$SECRET_DISCORD_PK_INPUT"
else
  read -rp "  discord_public_key:      " SECRET_DISCORD_PK
fi

if [[ -n "$SECRET_DISCORD_APP_ID" ]]; then
  read -rp "  discord_application_id [from .env, Enter to keep]:  " SECRET_DISCORD_APP_ID_INPUT
  [[ -n "$SECRET_DISCORD_APP_ID_INPUT" ]] && SECRET_DISCORD_APP_ID="$SECRET_DISCORD_APP_ID_INPUT"
else
  read -rp "  discord_application_id:  " SECRET_DISCORD_APP_ID
fi

if [[ -n "$SECRET_DISCORD_BOT_TOKEN" ]]; then
  read -rp "  discord_bot_token [from .env, Enter to keep]:      " SECRET_DISCORD_BOT_TOKEN_INPUT
  [[ -n "$SECRET_DISCORD_BOT_TOKEN_INPUT" ]] && SECRET_DISCORD_BOT_TOKEN="$SECRET_DISCORD_BOT_TOKEN_INPUT"
else
  read -rp "  discord_bot_token:      " SECRET_DISCORD_BOT_TOKEN
fi

if [[ -n "$SECRET_GEMINI" ]]; then
  read -rp "  gemini_api_key [from .env, Enter to keep]:          " SECRET_GEMINI_INPUT
  [[ -n "$SECRET_GEMINI_INPUT" ]] && SECRET_GEMINI="$SECRET_GEMINI_INPUT"
else
  read -rp "  gemini_api_key:          " SECRET_GEMINI
fi

if [[ -n "$SECRET_OPENROUTER" ]]; then
  read -rp "  openrouter_api_key [from .env, Enter to keep]:      " SECRET_OPENROUTER_INPUT
  [[ -n "$SECRET_OPENROUTER_INPUT" ]] && SECRET_OPENROUTER="$SECRET_OPENROUTER_INPUT"
else
  read -rp "  openrouter_api_key:      " SECRET_OPENROUTER
fi

if [[ -n "$SECRET_JINA" ]]; then
  read -rp "  jina_api_key [from .env, Enter to keep]:            " SECRET_JINA_INPUT
  [[ -n "$SECRET_JINA_INPUT" ]] && SECRET_JINA="$SECRET_JINA_INPUT"
else
  read -rp "  jina_api_key:            " SECRET_JINA
fi

# ─── Login + link ─────────────────────────────────────────────────────────────
echo ""
info "Logging in to Supabase..."
supabase login

info "Linking project $PROJECT_REF..."
supabase link --project-ref "$PROJECT_REF"

# ─── Push secrets ─────────────────────────────────────────────────────────────
echo ""
info "Pushing secrets..."

SECRETS_ARGS=()
[[ -n "$SECRET_DISCORD_PK"     ]] && SECRETS_ARGS+=("discord_public_key=$SECRET_DISCORD_PK")
[[ -n "$SECRET_DISCORD_APP_ID" ]] && SECRETS_ARGS+=("discord_application_id=$SECRET_DISCORD_APP_ID")
[[ -n "$SECRET_DISCORD_BOT_TOKEN" ]] && SECRETS_ARGS+=("discord_bot_token=$SECRET_DISCORD_BOT_TOKEN")
[[ -n "$SECRET_GEMINI"         ]] && SECRETS_ARGS+=("gemini_api_key=$SECRET_GEMINI")
[[ -n "$SECRET_OPENROUTER"     ]] && SECRETS_ARGS+=("openrouter_api_key=$SECRET_OPENROUTER")
[[ -n "$SECRET_JINA"           ]] && SECRETS_ARGS+=("jina_api_key=$SECRET_JINA")

if [[ ${#SECRETS_ARGS[@]} -gt 0 ]]; then
  supabase secrets set "${SECRETS_ARGS[@]}"
  success "Secrets pushed: ${#SECRETS_ARGS[@]} secret(s)"
else
  warn "No secrets entered — skipping. Set them manually in the Supabase dashboard."
fi

# ─── Deploy functions ─────────────────────────────────────────────────────────
echo ""
info "Deploying Edge Functions..."
echo "  ⚠  --no-verify-jwt is required on all functions so Discord can POST without a Supabase auth token."
echo ""

FUNCTIONS=(
  "discord-interactions"
  "grounded-llm-inference"
  "openrouter-llm-inference"
  "gemini-grounded-llm-inference"
  "settle-this"
)

FAILED=()
for FN in "${FUNCTIONS[@]}"; do
  info "Deploying $FN..."
  if supabase functions deploy "$FN" --no-verify-jwt; then
    success "$FN deployed"
  else
    warn "$FN failed — continuing with remaining functions"
    FAILED+=("$FN")
  fi
done

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  Done${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [[ ${#FAILED[@]} -gt 0 ]]; then
  warn "The following functions failed to deploy:"
  for FN in "${FAILED[@]}"; do echo "    - $FN"; done
  echo ""
fi

ANON_KEY_NOTE="Supabase Dashboard → Settings → API → Project API keys → Publishable key"
echo -e "  ${BOLD}Interactions Endpoint URL${NC} (set this in the Discord Developer Portal):"
echo "    https://${PROJECT_REF}.supabase.co/functions/v1/discord-interactions?apikey=<YOUR_ANON_KEY>"
echo ""
echo "  Find your anon key at: $ANON_KEY_NOTE"
echo ""
echo -e "  ${BOLD}Manual steps still required:${NC}"
echo "    1. Run the SQL migration in the Supabase SQL Editor"
echo "       (supabase/migrations/20260311000000_create_query_cache.sql)"
echo "    2. Set the Interactions Endpoint URL in the Discord Developer Portal"
echo "    3. Register your slash command (use scripts/register.sh)"
echo ""