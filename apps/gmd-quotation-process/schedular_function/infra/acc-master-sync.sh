#!/bin/sh
# Usage: acc-master-sync.sh  -- POSTs to $GMD_APP_SERVER/api/scheduler/acc-master
# Copies the ACC_MASTER_GID tab of GMD_EXECUTION_TRACKING_SPREADSHEET_ID into the
# local acc_master table (consignee code -> account name).
#
# Scheduled at :35, before execution-tracking (:40), which joins on this table.
# The execution-tracking step refreshes it as well, so this job is what keeps the
# list fresh for every other caller.
#
# Env (set in the ofelia container, not committed):
#   GMD_APP_SERVER      base URL of this app, e.g. http://gmd-quotation-process:4570
#   GMD_SYNC_API_KEY    must match GMD_SYNC_API_KEY on the app
set -eu

: "${GMD_APP_SERVER:?GMD_APP_SERVER is not set in the ofelia container}"
: "${GMD_SYNC_API_KEY:?GMD_SYNC_API_KEY is not set in the ofelia container}"

url="${GMD_APP_SERVER}/api/scheduler/acc-master"

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
  echo "ERROR: acc-master sync reported success=false"
  exit 1
fi

# A per-row failure still returns 200 with success:true, so check failedWrites.
if echo "$body" | grep -q '"failedWrites":[1-9]'; then
  echo "ERROR: acc-master reported one or more failed writes (see body)"
  exit 1
fi

echo "OK: acc-master sync completed"
