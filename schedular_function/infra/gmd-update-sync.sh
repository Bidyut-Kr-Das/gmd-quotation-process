#!/bin/sh
# Usage: gmd-update-sync.sh  -- POSTs to $GMD_APP_SERVER/api/scheduler/gmd-update/
# Runs the Raw Material sync: GMD UPDATION catalogue, then stock-phys physical stock.
#
# Failure modes, both of which must fail the job:
#   - Non-200: wget itself exits non-zero, and `set -e` aborts the script.
#   - 200 whose body reports success=false (e.g. a step failed but the route
#     still answered 200): caught by the grep below.
#
# Env (set in the ofelia container, not committed):
#   GMD_APP_SERVER      base URL of this app, e.g. http://gmd-quotation-process:4570
#   GMD_SYNC_API_KEY    must match GMD_SYNC_API_KEY on the app
set -eu

url="${GMD_APP_SERVER}/api/scheduler/gmd-update/"

echo "POST $url"
body=$(wget -qO- -T 1800 \
  --header 'Content-Type: application/json' \
  --header "x-api-key: ${GMD_SYNC_API_KEY}" \
  --post-data '{}' \
  "$url")

echo "$body"

if echo "$body" | grep -q '"success": *false'; then
  echo "ERROR: gmd-update sync reported success=false"
  exit 1
fi

echo "OK: gmd-update sync completed"