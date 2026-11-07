#!/usr/bin/env bash
# Register, inspect or remove the Telegram webhook.
#
#   scripts/telegram-webhook.sh set    <bot-token> <base-url> [secret]
#   scripts/telegram-webhook.sh info   <bot-token>
#   scripts/telegram-webhook.sh delete <bot-token>
#
# Token and URL are arguments rather than env vars because there is one
# bot per environment: production and preview each have their own token,
# and a token can hold only ONE webhook at a time. Pointing the
# production bot at a preview URL silently stops production working.
#
# Example:
#   scripts/telegram-webhook.sh set 123456:AA... https://household-ebon.vercel.app "$TELEGRAM_WEBHOOK_SECRET"
set -euo pipefail

COMMAND="${1:-}"
TOKEN="${2:-}"

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

[ -z "$COMMAND" ] && usage
[ -z "$TOKEN" ] && { echo "ERROR: bot token is required." >&2; usage; }

api() { echo "https://api.telegram.org/bot${TOKEN}/$1"; }

# Pretty-print if jq is around, otherwise raw JSON — no hard dependency.
pretty() { if command -v jq >/dev/null 2>&1; then jq .; else cat; fi; }

case "$COMMAND" in
  set)
    BASE_URL="${3:-}"
    [ -z "$BASE_URL" ] && { echo "ERROR: base URL is required (e.g. https://your-app.vercel.app)." >&2; usage; }

    SECRET="${4:-${TELEGRAM_WEBHOOK_SECRET:-}}"
    if [ -z "$SECRET" ]; then
      echo "ERROR: no secret. Pass it as the 4th argument or set TELEGRAM_WEBHOOK_SECRET." >&2
      echo "       Generate one with: openssl rand -hex 32" >&2
      exit 1
    fi

    # Telegram only accepts 1-256 chars of A-Z a-z 0-9 _ - for the secret.
    # Length and character class are checked separately: BSD grep (macOS)
    # refuses a {1,256} bound with "maximum repetition exceeds 255".
    if [ "${#SECRET}" -lt 1 ] || [ "${#SECRET}" -gt 256 ]; then
      echo "ERROR: the secret must be between 1 and 256 characters (got ${#SECRET})." >&2
      exit 1
    fi
    if printf '%s' "$SECRET" | LC_ALL=C grep -q '[^A-Za-z0-9_-]'; then
      echo "ERROR: the secret may only contain A-Z a-z 0-9 _ - (no spaces or punctuation)." >&2
      exit 1
    fi

    WEBHOOK_URL="${BASE_URL%/}/api/telegram"
    echo "Registering $WEBHOOK_URL ..."

    # --data-urlencode so a secret containing - or _ survives intact, and
    # the secret goes in the body rather than the URL so it stays out of
    # any proxy or shell history that logs URLs.
    curl -fsS -X POST "$(api setWebhook)" \
      --data-urlencode "url=${WEBHOOK_URL}" \
      --data-urlencode "secret_token=${SECRET}" \
      --data-urlencode "allowed_updates=[\"message\",\"callback_query\"]" \
      --data-urlencode "drop_pending_updates=true" | pretty

    echo
    echo "Verify with: $0 info <bot-token>"
    ;;

  info)
    curl -fsS "$(api getWebhookInfo)" | pretty
    ;;

  delete)
    curl -fsS -X POST "$(api deleteWebhook)" --data-urlencode "drop_pending_updates=true" | pretty
    ;;

  *)
    echo "ERROR: unknown command '$COMMAND'." >&2
    usage
    ;;
esac
