#!/bin/sh
# Usage: physical-stock-cost-bom-sync.sh  -- POSTs to
#        $GMD_APP_SERVER/api/scheduler/physical-stock-cost-bom
# Recomputes PhysicalStock.cost / bom_id: reads the BOM graph from the local
# database and writes the result to the stock DB PhysicalStock table.
#
# Scheduled at :10 — after bom-mast (:05), whose FullItem / Bom / BomItem rows
# this step reads. It writes only the stock DB, so it does not contend with supply-history
# (:15) for the local database.
#
# Failure modes, all of which must fail the job:
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
# /physical-stock-cost-bom/ would cost a 308 redirect hop before the handler.
url="${GMD_APP_SERVER}/api/scheduler/physical-stock-cost-bom"

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
  echo "ERROR: physical-stock-cost-bom sync reported success=false"
  exit 1
fi

echo "OK: physical-stock-cost-bom sync completed"
