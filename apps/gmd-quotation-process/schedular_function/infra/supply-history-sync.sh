#!/bin/sh
# Usage: supply-history-sync.sh  -- POSTs to $GMD_APP_SERVER/api/scheduler/supply-history
# Runs the MASTER sheet -> SupplyHistoryItem sync.
#
# Heaviest of the four hourly jobs: 4 Google calls and a full-table read plus a
# syncedAt bump over nearly every SupplyHistoryItem row. Scheduled at :15 so it
# does not collide with raw-material (:00) or contract-review (:30).
#
# Failure modes, all of which must fail the job:
#   - Non-200: wget itself exits non-zero, and `set -e` aborts the script.
#   - 200 whose body reports success=false: caught by the grep below.
#   - 200 with success=true but rows that failed to write: the orchestrator only
#     reports success=false when a step THROWS, so `failedWrites` is checked
#     separately.
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
# /supply-history/ would cost a 308 redirect hop before reaching the handler.
url="${GMD_APP_SERVER}/api/scheduler/supply-history"

# Cheap credential probe first: GET authenticates but does NOT run the job.
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
  echo "ERROR: supply-history sync reported success=false"
  exit 1
fi

# The orchestrator returns success:true unless a step THROWS, so rows that
# failed to write still arrive as 200 and are only visible in the step counters
# (`failedWrites` nests under `steps.masterSync`). Fail the job on any of them
# rather than printing OK over a half-written table. Same reasoning as the
# failedTables check in c-batch-sync.sh.
if echo "$body" | grep -q '"failedWrites": *[1-9]'; then
  echo "ERROR: supply-history reported row write failures (see body)"
  exit 1
fi

echo "OK: supply-history sync completed"