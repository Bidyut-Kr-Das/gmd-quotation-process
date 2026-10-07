#!/bin/sh
# Usage: docket-creation-sync.sh  -- POSTs to $GMD_APP_SERVER/api/scheduler/docket-creation
# Materializes dockets for every DocketQuotationThread flagged pendingDocket = true:
# creates a header-only Enquiry, links mail attachments, generates the snapshot
# PDF, and stamps the thread with the new docket number.
#
# Idempotent: a stamped thread leaves the pending set, so re-running is a no-op.
#
# Scheduled at :20, between supply-history (:15) and contract-review (:30), so
# contract-review's same-hour pass can backfill contractNo on the new dockets.
#
# Env (set in the ofelia container, not committed):
#   GMD_APP_SERVER      base URL of this app, e.g. http://gmd-quotation-process:4570
#   GMD_SYNC_API_KEY    must match GMD_SYNC_API_KEY on the app
set -eu

: "${GMD_APP_SERVER:?GMD_APP_SERVER is not set in the ofelia container}"
: "${GMD_SYNC_API_KEY:?GMD_SYNC_API_KEY is not set in the ofelia container}"

url="${GMD_APP_SERVER}/api/scheduler/docket-creation"

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
body=$(wget -qO- -T 900 \
  --header 'Content-Type: application/json' \
  --header "x-api-key: ${GMD_SYNC_API_KEY}" \
  --post-data '{}' \
  "$url")

echo "$body"

if echo "$body" | grep -q '"success": *false'; then
  echo "ERROR: docket-creation sync reported success=false"
  exit 1
fi

# A per-docket failure still returns 200 with success:true, so check `failed`
# explicitly rather than relying on the exit status alone. Same reasoning as the
# failedTables check in c-batch-sync.sh.
if echo "$body" | grep -q '"failed": *[1-9]'; then
  echo "ERROR: docket-creation reported one or more failed dockets (see body)"
  exit 1
fi

echo "OK: docket-creation sync completed"
