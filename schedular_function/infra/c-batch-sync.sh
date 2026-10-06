#!/bin/sh
# Usage: c-batch-sync.sh  -- POSTs to $GMD_APP_SERVER/api/scheduler/c-batch
# Marks cBatch="C" on every row whose item code carries ITEM_STATUS = "C" in the
# ITEM MASTER ERP tab, across RawMaterial, ContractReview, SupplyHistoryItem and
# EnquiryItem.
#
# Set-only: nothing is ever cleared, so re-running is idempotent.
#
# Scheduled at :45, last of the four hourly jobs. Overlap with another job is
# safe by construction — this one writes only the cBatch column, which no other
# scheduled job touches.
#
# Env (set in the ofelia container, not committed):
#   GMD_APP_SERVER      base URL of this app, e.g. http://gmd-quotation-process:4570
#   GMD_SYNC_API_KEY    must match GMD_SYNC_API_KEY on the app
set -eu

: "${GMD_APP_SERVER:?GMD_APP_SERVER is not set in the ofelia container}"
: "${GMD_SYNC_API_KEY:?GMD_SYNC_API_KEY is not set in the ofelia container}"

url="${GMD_APP_SERVER}/api/scheduler/c-batch"

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
body=$(wget -qO- -T 600 \
  --header 'Content-Type: application/json' \
  --header "x-api-key: ${GMD_SYNC_API_KEY}" \
  --post-data '{}' \
  "$url")

echo "$body"

if echo "$body" | grep -q '"success": *false'; then
  echo "ERROR: c-batch sync reported success=false"
  exit 1
fi

# A per-table failure still returns 200 with success:true, so check failedTables
# explicitly rather than relying on the exit status alone.
if echo "$body" | grep -q '"failedTables":\[[^]]'; then
  echo "ERROR: c-batch reported one or more failed tables (see body)"
  exit 1
fi

echo "OK: c-batch sync completed"