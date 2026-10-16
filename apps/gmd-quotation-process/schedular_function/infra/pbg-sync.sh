#!/bin/sh
# Usage: pbg-sync.sh  -- POSTs to $GMD_APP_SERVER/api/scheduler/pbg
# Runs the PBG sheet -> PbgData sync.
#
# Light job: one sheet read and an upsert of a small table. Runs every 1.2h
# (ofelia `@every 1h12m`). It writes only PbgData, which no other job touches,
# so overlap with any other job is harmless.
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
# /pbg/ would cost a 308 redirect hop before reaching the handler.
url="${GMD_APP_SERVER}/api/scheduler/pbg"

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
  echo "ERROR: pbg sync reported success=false"
  exit 1
fi

echo "OK: pbg sync completed"
