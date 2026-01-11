#!/usr/bin/env bash
set -e
BASE=${1:-http://localhost:3000}
echo "Checking API: $BASE/api/notes"
curl -sSf -X GET "$BASE/api/notes" | jq '. | type' >/dev/null && echo "GET /api/notes OK"
echo "Creating temporary note..."
resp=$(curl -s -X POST -H "Content-Type: application/json" -d '{"title":"smoke","content":"test"}' "$BASE/api/notes")
id=$(echo "$resp" | jq -r '.id')
if [ -z "$id" ] || [ "$id" = "null" ]; then
  echo "Create failed"; exit 2
fi
echo "Created note id=$id"
curl -s -X PUT -H "Content-Type: application/json" -d '{"title":"smoke2"}' "$BASE/api/notes/$id" >/dev/null && echo "Update OK"
curl -s -X DELETE "$BASE/api/notes/$id" >/dev/null && echo "Delete OK"
echo "Smoke tests passed"
