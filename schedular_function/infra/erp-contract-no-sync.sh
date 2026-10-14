#!/bin/sh
# Usage: erp-contract-no-sync.sh  -- POSTs to $GMD_APP_SERVER/api/scheduler/erp-contract-no
# Fills SupplyHistoryItem.erpContractNo from the MC_GID tab of
# GMD_EXECUTION_TRACKING_SPREADSHEET_ID, keyed on
# SALE BILL.ORDER_VRNO = MC.VRNO -> MC.CONTRACT_VRNO, for the current fiscal
# year (April start).
#
# Scheduled at :50 of every even hour (every 2 hours) — after execution-tracking
# (:40) has written the SupplyHistoryItem rows for a new invoice.
#
# Env (set in the ofelia container, not committed):
#   GMD_APP_SERVER      base URL of this app, e.g. http://gmd-quotation-process:4570
#   GMD_SYNC_API_KEY    must match GMD_SYNC_API_KEY on the app
set -eu

: "${GMD_APP_SERVER:?GMD_APP_SERVER is not set in the ofelia container}"
: "${GMD_SYNC_API_KEY:?GMD_SYNC_API_KEY is not set in the ofelia container}"

url="${GMD_APP_SERVER}/api/scheduler/erp-contract-no"

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
  echo "ERROR: erp-contract-no sync reported success=false"
  exit 1
fi

# A per-invoice failure still returns 200 with success:true, so check failedWrites.
if echo "$body" | grep -q '"failedWrites":[1-9]'; then
  echo "ERROR: erp-contract-no reported one or more failed writes (see body)"
  exit 1
fi

# An overwrite means MC disagreed with the stored (MASTER-sourced) value. That is
# expected on a real correction, but a persistent count is worth a look: the
# supply-history job writes the same column from MASTER, so a disagreement that
# never settles means the two sources carry different spellings.
if echo "$body" | grep -q '"overwrittenRows":[1-9]'; then
  echo "WARN: erp-contract-no overwrote one or more stored contract numbers (see body)"
fi

# An ORDER_VRNO on the sheet that MC does not carry means the invoice cannot be
# resolved. Visible, not silent.
if echo "$body" | grep -q '"unmatchedOrderVrno":[1-9]'; then
  echo "WARN: erp-contract-no could not resolve one or more ORDER_VRNOs (see body)"
fi

echo "OK: erp-contract-no sync completed"
