#!/usr/bin/env bash
set -euo pipefail

# https://runtracker.elliscode.com/ is served from this bucket's root.
BUCKET="daniel-townsend-run-tracker"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# One source of truth for the distance/pace math: the app's copy.
cp ../frontend/src/js/stats.js js/stats.js

if ! command -v aws >/dev/null 2>&1; then
  echo "Error: aws CLI not found on PATH." >&2
  exit 1
fi

files=$(find . \
  -type d \( -name '.git' -o -name 'node_modules' \) -prune -o \
  -type f \( -name '*.js' -o -name '*.html' -o -name '*.css' \
          -o -name '*.png' -o -name '*.jpg' -o -name '*.webp' \) -print)

while IFS= read -r file; do
  rel_path="${file#./}"
  dest="s3://$BUCKET/$rel_path"
  echo "Uploading $rel_path -> $dest"
  aws s3 cp "$file" "$dest"
done <<< "$files"

echo "Done. Uploaded to s3://$BUCKET/"
