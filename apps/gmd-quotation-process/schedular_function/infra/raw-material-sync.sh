#!/bin/sh
# Usage: raw-material-sync.sh  -- POSTs to $GMD_APP_SERVER/api/scheduler/raw-material/
# Runs the Raw Material sync: GMD UPDATION catalogue, stock-phys physical stock,
# then item names (ITEM MASTER ERP -> RawMaterial.itemNameAuto).
#
# Failure modes, all of which must fail the job:
#   - Non-200: wget itself exits non-zero, and `set -e` aborts the script.
#   - 200 whose body reports success=false (e.g. a step failed but the route
#     still answered 200): caught by the grep below.
#   - 200 with success=true but rows that failed to write: the orchestrator only
#     reports success=false when a step THROWS, so `failedWrites` is checked
#     separately.
#
# Env (set in the ofelia container, not committed):
#   GMD_APP_SERVER      base URL of this app, e.g. http://gmd-quotation-process:4570
#   GMD_SYNC_API_KEY    must match GMD_SYNC_API_KEY on the app
set -eu

# Fail loudly when the secret is missing. Without the :- guard an unset variable
# expands to empty and we send `x-api-key: `, which the app answers with an
# opaque 401 instead of telling us the ofelia container is misconfigured.
: "${GMD_APP_SERVER:?GMD_APP_SERVER is not set in the ofelia container}"
: "${GMD_SYNC_API_KEY:?GMD_SYNC_API_KEY is not set in the ofelia container}"

# No trailing slash — the app runs with the default trailingSlash:false, so
# /raw-material/ would cost a 308 redirect hop before reaching the handler.
url="${GMD_APP_SERVER}/api/scheduler/raw-material"

echo "POST $url (key length ${#GMD_SYNC_API_KEY})"
body=$(wget -qO- -T 1800 \
  --header 'Content-Type: application/json' \
  --header "x-api-key: ${GMD_SYNC_API_KEY}" \
  --post-data '{}' \
  "$url")

echo "$body"

if echo "$body" | grep -q '"success": *false'; then
  echo "ERROR: raw-material sync reported success=false"
  exit 1
fi

# The orchestrator returns success:true unless a step THROWS, so rows that
# failed to write still arrive as 200 and are only visible in the step counters
# (catalogue and stock both nest `failedWrites` under `steps`). Fail the job on
# any of them rather than printing OK over a half-written table. Same reasoning
# as the failedTables check in c-batch-sync.sh.
if echo "$body" | grep -q '"failedWrites": *[1-9]'; then
  echo "ERROR: raw-material reported row write failures (see body)"
  exit 1
fi

echo "OK: raw-material sync completed"