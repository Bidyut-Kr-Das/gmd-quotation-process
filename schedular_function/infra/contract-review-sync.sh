#!/bin/sh
# Usage: contract-review-sync.sh  -- POSTs to $GMD_APP_SERVER/api/scheduler/contract-review
# Runs the Contract Review sync, three steps in order:
#   1. CONTRACTS + DUMP sheet -> ContractReview
#   2. Enquiry fields (State / Utility / Project Reference)
#   3. RM AVAIL: raw-material stock, VerifyBom, RM AVAIL, PHYSICAL STOCK
#
# Heavier than raw-material-sync.sh — two full-column spreadsheet reads and a
# large table rewrite — so it is scheduled at :30 rather than :00 to keep the two
# jobs from contending.
#
# Failure modes, both of which must fail the job:
#   - Non-200: wget itself exits non-zero, and `set -e` aborts the script.
#   - 200 whose body reports success=false: caught by the grep below.
#
# Env (set in the ofelia container, not committed):
#   GMD_APP_SERVER      base URL of this app, e.g. http://gmd-quotation-process:4570
#   GMD_SYNC_API_KEY    must match GMD_SYNC_API_KEY on the app
set -eu

# Fail loudly when the secret is missing, rather than sending an empty
# `x-api-key:` header and getting back an opaque 401.
: "${GMD_APP_SERVER:?GMD_APP_SERVER is not set in the ofelia container}"
: "${GMD_SYNC_API_KEY:?GMD_SYNC_API_KEY is not set in the ofelia container}"

# No trailing slash — the app runs with the default trailingSlash:false, so
# /contract-review/ would cost a 308 redirect hop before reaching the handler.
url="${GMD_APP_SERVER}/api/scheduler/contract-review"

# Cheap credential probe first: GET authenticates but does NOT run the job, so a
# key mismatch is reported in milliseconds instead of after a long sync.
probe=$(wget -qO- -T 30 --header "x-api-key: ${GMD_SYNC_API_KEY}" "${url}" || true)
case "$probe" in
  *'"auth":"ok"'*) : ;;
  *)
    echo "ERROR: credential probe failed for $url"
    echo "$probe"
    exit 1
    ;;
esac

echo "POST $url (key length ${#GMD_SYNC_API_KEY})"
body=$(wget -qO- -T 1800 \
  --header 'Content-Type: application/json' \
  --header "x-api-key: ${GMD_SYNC_API_KEY}" \
  --post-data '{}' \
  "$url")

echo "$body"

if echo "$body" | grep -q '"success": *false'; then
  echo "ERROR: contract-review sync reported success=false"
  exit 1
fi

echo "OK: contract-review sync completed"