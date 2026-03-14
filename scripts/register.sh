#!/usr/bin/env bash
# register.sh — Register slash commands with Discord
# Requires: curl
# Usage: bash scripts/register.sh
#
# Run this once after deploying. Re-running is safe — Discord upserts commands.
# Global commands can take up to an hour to propagate; guild commands are instant.

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
echo -e "${BOLD}  Discord Bot — Register Slash Commands         ${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ─── Check dependencies ────────────────────────────────────────────────────────
if ! command -v curl &>/dev/null; then
  fatal "curl not found. Install with: brew install curl"
fi

# ─── Inputs ───────────────────────────────────────────────────────────────────
echo -e "${BOLD}Discord credentials${NC}"
echo "  Bot token:        Discord Developer Portal → your app → Bot → Token"
echo "  Application ID:   Discord Developer Portal → your app → General Information"
echo ""
BOT_TOKEN="${discord_bot_token:-${BOT_TOKEN:-}}"
APP_ID="${discord_application_id:-${discord_bot_client_id:-${APP_ID:-}}}"

if [[ -n "$BOT_TOKEN" ]]; then
  read -rp "  Bot token [from .env, Enter to keep]:          " BOT_TOKEN_INPUT
  [[ -n "$BOT_TOKEN_INPUT" ]] && BOT_TOKEN="$BOT_TOKEN_INPUT"
else
  read -rp "  Bot token:          " BOT_TOKEN
fi

if [[ -n "$APP_ID" ]]; then
  read -rp "  Application ID [from .env, Enter to keep]:     " APP_ID_INPUT
  [[ -n "$APP_ID_INPUT" ]] && APP_ID="$APP_ID_INPUT"
else
  read -rp "  Application ID:     " APP_ID
fi
[[ -z "$BOT_TOKEN" ]] && fatal "Bot token cannot be empty."
[[ -z "$APP_ID"    ]] && fatal "Application ID cannot be empty."

echo ""
echo -e "${BOLD}Scope${NC}"
echo "  [1] Global  — available in all servers (propagates in up to 60 min)"
echo "  [2] Guild   — instant, one specific server (good for testing)"
echo ""
read -rp "  Choose [1/2]: " SCOPE_CHOICE

GUILD_ID=""
if [[ "$SCOPE_CHOICE" == "2" ]]; then
  echo ""
  echo "  Guild (server) ID: right-click your server icon in Discord → Copy Server ID"
  echo "  (Enable Developer Mode in Discord Settings → Advanced if the option is missing)"
  GUILD_ID="${discord_guild_id:-${GUILD_ID:-}}"
  if [[ -n "$GUILD_ID" ]]; then
    read -rp "  Guild ID [from .env, Enter to keep]: " GUILD_ID_INPUT
    [[ -n "$GUILD_ID_INPUT" ]] && GUILD_ID="$GUILD_ID_INPUT"
  else
    read -rp "  Guild ID: " GUILD_ID
  fi
  [[ -z "$GUILD_ID" ]] && fatal "Guild ID cannot be empty for guild scope."
fi

# ─── Build endpoint ───────────────────────────────────────────────────────────
if [[ "$SCOPE_CHOICE" == "2" ]]; then
  ENDPOINT="https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands"
  SCOPE_LABEL="guild (ID: $GUILD_ID)"
else
  ENDPOINT="https://discord.com/api/v10/applications/${APP_ID}/commands"
  SCOPE_LABEL="global"
fi

# ─── Command definitions ──────────────────────────────────────────────────────
# Edit this section to add, remove, or rename commands.
# Each entry below registers one slash command.
# "name" must match the keys in commandToFunction in discord-interactions/index.ts.
#
# option type 3 = STRING

register_command() {
  local NAME="$1"
  local DESCRIPTION="$2"
  local OPTION_NAME="$3"
  local OPTION_DESCRIPTION="$4"

  info "Registering /${NAME} (${SCOPE_LABEL})..."

  HTTP_STATUS=$(curl -s -o /tmp/discord_resp.json -w "%{http_code}" \
    -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bot ${BOT_TOKEN}" \
    -d "{
      \"name\": \"${NAME}\",
      \"description\": \"${DESCRIPTION}\",
      \"options\": [{
        \"name\": \"${OPTION_NAME}\",
        \"description\": \"${OPTION_DESCRIPTION}\",
        \"type\": 3,
        \"required\": true
      }]
    }")

  if [[ "$HTTP_STATUS" == "200" || "$HTTP_STATUS" == "201" ]]; then
    success "/${NAME} registered (HTTP $HTTP_STATUS)"
  else
    warn "/${NAME} — unexpected response (HTTP $HTTP_STATUS):"
    cat /tmp/discord_resp.json
    echo ""
  fi
}

echo ""
echo -e "${BOLD}Registering commands${NC}"
echo "  Scope: ${SCOPE_LABEL}"
echo ""

# ── /ask → grounded-llm-inference ────────────────────────────────────────────
register_command \
  "ask" \
  "Ask a question (Gemini + Google Search grounding)" \
  "question" \
  "Your question"

# ── /openrouter → openrouter-llm-inference ────────────────────────────────────
# The openrouter-llm-inference function reads the option name "query", not "question".
# If you change the option name here, update the function too (and vice versa).
register_command \
  "openrouter" \
  "Ask a question via OpenRouter free models" \
  "query" \
  "Your question"

# ── /settlethis → settle-this ─────────────────────────────────────────────────
info "Registering /settlethis (${SCOPE_LABEL})..."

HTTP_STATUS=$(curl -s -o /tmp/discord_resp.json -w "%{http_code}" \
  -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bot ${BOT_TOKEN}" \
  -d '{
    "name": "settlethis",
    "description": "Judge the last 30 messages and decide who has the stronger case"
  }')

if [[ "$HTTP_STATUS" == "200" || "$HTTP_STATUS" == "201" ]]; then
  success "/settlethis registered (HTTP $HTTP_STATUS)"
else
  warn "/settlethis — unexpected response (HTTP $HTTP_STATUS):"
  cat /tmp/discord_resp.json
  echo ""
fi

# ── Add more commands here using the same pattern ─────────────────────────────
# register_command "command-name" "Description shown in Discord" "option-name" "Option description"

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  Done${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [[ "$SCOPE_CHOICE" == "2" ]]; then
  success "Guild commands are available immediately."
else
  warn "Global commands can take up to 60 minutes to appear in Discord."
  echo "  Tip: test with guild scope first, then re-run with global scope when ready."
fi

echo ""
echo "  To add or rename commands: edit the register_command calls in this script,"
echo "  then re-run. Discord upserts on name — safe to run multiple times."
echo ""