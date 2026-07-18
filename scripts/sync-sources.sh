#!/usr/bin/env bash
# Populates .sources/<name> with read-only checkouts of the sibling repos this
# site parses at build time (dotfiles, bin, academia). Never executes any code
# from these repos -- only files inside them are read by loaders/build scripts.
#
# Preference order per repo:
#   1. A local checkout at LOCAL_<NAME>_DIR (or the conventional path below) --
#      copied in for fast local iteration.
#   2. `git clone --depth 1` from GitHub (what CI does, via sparse checkout in
#      the workflow instead of this script).
#
# Safe to re-run: pulls if already cloned, re-copies if using a local source.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCES_DIR="$REPO_ROOT/.sources"
mkdir -p "$SOURCES_DIR"

GITHUB_ORG="IllyaStarikov"

# name -> "github-repo-name:local-fallback-path"
declare -a SPECS=(
  "dotfiles:.dotfiles:$HOME/.dotfiles"
  "bin:bin:$HOME/Documents/development/bin"
  "academia:academia:"
)

sync_one() {
  local name="$1" gh_repo="$2" local_dir="$3"
  local dest="$SOURCES_DIR/$name"

  if [[ -n "$local_dir" && -d "$local_dir" ]]; then
    echo "sync-sources: $name <- local copy from $local_dir"
    rm -rf "$dest"
    mkdir -p "$dest"
    # Exclude VCS internals and anything already-ignored/heavy; we only need
    # the tracked working tree contents.
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --exclude ".git" "$local_dir/" "$dest/"
    else
      cp -R "$local_dir/." "$dest/"
      rm -rf "$dest/.git"
    fi
    return 0
  fi

  local url="https://github.com/$GITHUB_ORG/$gh_repo.git"
  if [[ -d "$dest/.git" ]]; then
    echo "sync-sources: $name <- git pull ($url)"
    git -C "$dest" pull --ff-only --depth 1 2>&1 || {
      echo "sync-sources: $name pull failed, re-cloning"
      rm -rf "$dest"
      git clone --depth 1 "$url" "$dest"
    }
  else
    echo "sync-sources: $name <- git clone --depth 1 ($url)"
    rm -rf "$dest"
    if ! git clone --depth 1 "$url" "$dest" 2>&1; then
      echo "sync-sources: WARNING -- could not clone $name from $url (no local fallback either); leaving .sources/$name absent" >&2
      rm -rf "$dest"
      return 1
    fi
  fi
}

status=0
for spec in "${SPECS[@]}"; do
  IFS=':' read -r name gh_repo local_dir <<<"$spec"
  sync_one "$name" "$gh_repo" "$local_dir" || status=1
done

exit $status
