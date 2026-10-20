#!/usr/bin/env bash
# Scraped gallery data lives on the orphan `data` branch, not on main:
#   docs/titles/*.json, docs/titles.json, docs/gallery.json  (gitignored on main)
#
#   ./data.sh pull              Fetch the data branch and unpack it into docs/
#   ./data.sh publish [msg]     Merge local data with the remote data branch
#                               (newest scrape per title wins), rebuild the index,
#                               commit to `data` and push. Used by CI and locally.
set -euo pipefail
cd "$(dirname "$0")"

BRANCH=data
DATA_PATHS=(docs/titles docs/titles.json docs/gallery.json)

pull() {
  git fetch -q origin "$BRANCH"
  git archive "origin/$BRANCH" "${DATA_PATHS[@]}" | tar -x
  echo "Pulled $(git ls-tree -r --name-only "origin/$BRANCH" docs/titles | grep -c '\.json$') titles from origin/$BRANCH"
}

# Copy titles from $1 into $2 unless $2 already has a newer scrape (by the JSON "timestamp")
merge_newer_titles() {
  python3 - "$1" "$2" <<'EOF'
import json, os, shutil, sys
src, dst = sys.argv[1:]
def ts(path):
    try:
        with open(path) as f:
            return json.load(f).get("timestamp", 0)
    except (OSError, ValueError):
        return -1
os.makedirs(dst, exist_ok=True)
for name in os.listdir(src):
    s, d = os.path.join(src, name), os.path.join(dst, name)
    if name.endswith(".json") and (not os.path.exists(d) or ts(s) > ts(d)):
        shutil.copy2(s, d)
EOF
}

publish() {
  local msg="${1:-chore: update gallery data [skip ci]}"
  # Global (not local): the EXIT trap runs after this function has returned
  wt="$(mktemp -d)"
  trap 'git worktree remove --force "$wt" >/dev/null 2>&1 || true' EXIT

  git fetch -q origin "$BRANCH"
  git worktree add -q --detach "$wt" "origin/$BRANCH"

  for attempt in 1 2 3 4 5; do
    # Bring in titles published elsewhere, then rebuild the registry over the union
    merge_newer_titles "$wt/docs/titles" docs/titles
    python3 scraper.py --rebuild-index

    merge_newer_titles docs/titles "$wt/docs/titles"
    cp docs/titles.json docs/gallery.json "$wt/docs/"
    git -C "$wt" add docs
    if git -C "$wt" diff --cached --quiet; then
      echo "No gallery data changes to publish."
      return 0
    fi
    git -C "$wt" commit -q -m "$msg"
    if git -C "$wt" push -q origin "HEAD:$BRANCH"; then
      echo "Published gallery data to origin/$BRANCH"
      return 0
    fi

    echo "Push rejected (attempt $attempt), syncing with origin/$BRANCH and retrying..."
    sleep 3
    git fetch -q origin "$BRANCH"
    git -C "$wt" reset -q --hard "origin/$BRANCH"
  done

  echo "Failed to publish gallery data after 5 attempts." >&2
  return 1
}

case "${1:-}" in
  pull) pull ;;
  publish) shift; publish "${1:-}" ;;
  *) echo "Usage: $0 pull | publish [commit message]" >&2; exit 2 ;;
esac
