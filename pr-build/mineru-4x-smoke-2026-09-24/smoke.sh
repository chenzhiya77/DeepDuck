#!/usr/bin/env bash
# Raw curl proof of the MinerU 4.x HTTP contract (plan Task 1, step 4).
# Six steps: create upload -> PUT bytes -> complete -> create job -> poll -> fetch zip.
set -u

BASE="${BASE:-http://127.0.0.1:8000}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE${RUN:+/$RUN}"
mkdir -p "$OUT"
PDF="${PDF:-$HERE/sample.pdf}"
PY="${PY:-/e/app-mode/mineru-4x/venv/Scripts/python.exe}"
TIER="${TIER:-flash}"
SIZE=$(stat -c %s "$PDF")

jget() { "$PY" -c "import json,sys;d=json.load(open(sys.argv[1],encoding='utf-8'));print(eval(sys.argv[2],{'d':d}))" "$1" "$2"; }

echo "== 0) health =="
curl -sS -o "$OUT/00-health.json" -D "$OUT/00-health.headers" "$BASE/v1/health"
cat "$OUT/00-health.json"; echo

echo "== 1) POST /v1/uploads =="
curl -sS -D "$OUT/01-create-upload.headers" -o "$OUT/01-create-upload.json" \
  -X POST "$BASE/v1/uploads" -H 'Content-Type: application/json' \
  -d "{\"filename\":\"$(basename "$PDF")\",\"bytes\":$SIZE,\"mime_type\":\"application/pdf\",\"purpose\":\"parse\"}"
cat "$OUT/01-create-upload.json"; echo
UPLOAD_ID=$(jget "$OUT/01-create-upload.json" "d['id']")
UPLOAD_URL=$(jget "$OUT/01-create-upload.json" "d['upload_url']")
CT=$(jget "$OUT/01-create-upload.json" "(d.get('upload_headers') or {}).get('Content-Type')")
STATUS0=$(jget "$OUT/01-create-upload.json" "d['status']")
echo "upload_id=$UPLOAD_ID status=$STATUS0 content_type=$CT"
echo "upload_url=$UPLOAD_URL"
echo "$UPLOAD_ID" > "$OUT/01-upload-id.txt"

echo "== 2) PUT upload_url =="
curl -sS -D "$OUT/02-put-content.headers" -o "$OUT/02-put-content.body" \
  -X PUT "$UPLOAD_URL" -H "Content-Type: $CT" --data-binary "@$PDF"
head -1 "$OUT/02-put-content.headers"
cat "$OUT/02-put-content.body"; echo

echo "== 3) POST /v1/uploads/{id}/complete =="
curl -sS -D "$OUT/03-complete.headers" -o "$OUT/03-complete.json" \
  -X POST "$BASE/v1/uploads/$UPLOAD_ID/complete" -H 'Content-Type: application/json' -d '{}'
cat "$OUT/03-complete.json"; echo
FILE_ID=$(jget "$OUT/03-complete.json" "d['file']['id']")
echo "file_id=$FILE_ID"

echo "== 4) POST /v1/parse/jobs =="
curl -sS -D "$OUT/04-create-job.headers" -o "$OUT/04-create-job.json" \
  -X POST "$BASE/v1/parse/jobs" -H 'Content-Type: application/json' \
  -d "{\"files\":[{\"source\":{\"type\":\"file_id\",\"file_id\":\"$FILE_ID\"}}],\"output_formats\":[\"zip\"],\"tier\":\"$TIER\"}"
cat "$OUT/04-create-job.json"; echo
JOB_ID=$(jget "$OUT/04-create-job.json" "d['job_id']")
echo "job_id=$JOB_ID"

echo "== 5) poll GET /v1/parse/jobs/{id} =="
: > "$OUT/05-poll.log"
for i in $(seq 1 300); do
  curl -sS -o "$OUT/05-job.json" "$BASE/v1/parse/jobs/$JOB_ID"
  ST=$(jget "$OUT/05-job.json" "d['status']")
  echo "$(date +%H:%M:%S) poll=$i status=$ST" | tee -a "$OUT/05-poll.log"
  case "$ST" in completed|partial|failed|canceled) break;; esac
  sleep 2
done
cp "$OUT/05-job.json" "$OUT/05-job-final.json"
cat "$OUT/05-job-final.json"; echo
jget "$OUT/05-job-final.json" "d['files'][0].get('error')" > "$OUT/05-file-error.txt"
ZIP_ID=$(jget "$OUT/05-job-final.json" "(d['files'][0].get('output_files') or {}).get('zip',{}).get('file_id')")
echo "tier=$(jget "$OUT/05-job-final.json" "d['tier']") zip_file_id=$ZIP_ID"

echo "== 6) GET /v1/files/{zip}/content =="
curl -sS -D "$OUT/06-zip.headers" -o "$OUT/06-result.zip" "$BASE/v1/files/$ZIP_ID/content"
ls -l "$OUT/06-result.zip"
"$PY" - "$OUT/06-result.zip" <<'PYEOF' | tee "$OUT/06-zip-entries.txt"
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as zf:
    for info in zf.infolist():
        print(f"{info.file_size:>9}  {info.filename}")
PYEOF
echo "== done =="