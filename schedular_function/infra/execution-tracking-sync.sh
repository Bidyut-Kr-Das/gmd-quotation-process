#!/bin/sh
# Usage: execution-tracking-sync.sh  -- POSTs to $GMD_APP_SERVER/api/scheduler/execution-tracking
# Refreshes acc_master, then diffs the SALE_BILL_GID tab of
# GMD_EXECUTION_TRACKING_SPREADSHEET_ID into SupplyHistoryItem for the current
# fiscal year (April start).
#
# Scheduled at :40 — after acc-master (:35) has the name list ready and after
# supply-history (:15) has written the MASTER rows this one patches.
#
# Env (set in the ofelia container, not committed):
#   GMD_APP_SERVER      base URL of this app, e.g. http://gmd-quotation-process:4570
#   GMD_SYNC_API_KEY    must match GMD_SYNC_API_KEY on the app
set -eu

: "${GMD_APP_SERVER:?GMD_APP_SERVER is not set in the ofelia container}"
: "${GMD_SYNC_API_KEY:?GMD_SYNC_API_KEY is not set in the ofelia container}"

url="${GMD_APP_SERVER}/api/scheduler/execution-tracking"

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
  echo "ERROR: execution-tracking sync reported success=false"
  exit 1
fi

# A per-row failure still returns 200 with success:true, so check failedWrites.
if echo "$body" | grep -q '"failedWrites":[1-9]'; then
  echo "ERROR: execution-tracking reported one or more failed writes (see body)"
  exit 1
fi

# An ambiguous invoice is a data-shape signal worth shouting about: the sheet has
# rows whose invoice maps to several DB rows that ITEM_CODE cannot split, so those
# rows were deliberately left alone. Surface it rather than let it pass quietly.
if echo "$body" | grep -q '"ambiguous":[1-9]'; then
  echo "WARN: execution-tracking skipped one or more ambiguous invoices (see body)"
fi

echo "OK: execution-tracking sync completed"
