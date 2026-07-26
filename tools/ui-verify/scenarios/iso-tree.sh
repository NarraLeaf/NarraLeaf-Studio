#!/bin/bash
# Build a fresh isolated acceptance tree containing ONLY the branch under test.
#
# The shared checkout carries other sessions' uncommitted work (84 files in someone else's index at
# the time of writing), and a `yarn dev` there renders their changes too — which is how a previous
# card shipped code that adapted to a symbol that existed only in an uncommitted diff. So acceptance
# is done on a tree produced by `git archive <branch>`, which by construction contains nothing else.
#
# The node_modules junction is NOT done here: mklink is a cmd builtin and Git Bash mangles the
# backslashes on the way in. Run the PowerShell one-liner this prints at the end.
#
#   usage: iso-build.sh <branch> [isoDir]
set -e

BRANCH="${1:?usage: iso-build.sh <branch> [isoDir]}"
ISO="${2:?usage: iso-tree.sh <branch> <isoDir>}"
REPO="${NLS_REPO:-$(cd "$(dirname "$0")/../../.." && pwd)}"

cd "$REPO"
git rev-parse --verify "$BRANCH" >/dev/null

rm -rf "$ISO"
mkdir -p "$ISO"
git archive "$BRANCH" | tar -x -C "$ISO"
cp yarn.lock "$ISO/"                       # gitignored, but yarn 4 refuses to run without it

# A fresh profile every round: probes leave selected rows and open tabs behind, and a state that
# has been probed can no longer reproduce "nothing selected" (handoff 6.9). Seeded by COPYING the
# main checkout's dev profile (read-only on it), then repointing recents at the project COPY so an
# acceptance run cannot reach the shared demo3 even by accident.
mkdir -p "$ISO/.dev/temp"
# Seed from a previously-captured pristine copy, NOT from the main checkout's live profile:
# that one belongs to a running Studio and its leveldb LOCK files are open, which fails the copy.
SEED=${SEED:-/d/Temp/nls-u4-acc/.dev/temp/userData-pristine}
[ -d "$SEED" ] || SEED="$REPO/.dev/temp/userData-dev"
cp -r "$SEED" "$ISO/.dev/temp/userData-dev"
rm -f "$ISO/.dev/temp/userData-dev/state/global.json.tmp-"*
node "$(dirname "$0")/point-recents-at.js" "$ISO/.dev/temp/userData-dev/state" "${NLS_VERIFY_PROJECT:?set NLS_VERIFY_PROJECT to the project COPY this run may open}"
cp -r "$ISO/.dev/temp/userData-dev" "$ISO/.dev/temp/userData-pristine"

echo "iso tree:  $ISO"
echo "branch:    $BRANCH @ $(git rev-parse --short "$BRANCH")"
echo "files:     $(find "$ISO/src" -type f | wc -l) under src/"
echo
echo "NEXT — junction node_modules (PowerShell):"
echo "  cmd /c mklink /J \"$(cygpath -w "$ISO")\\node_modules\" \"D:\\Dev\\org\\NarraLeaf\\NarraLeaf-Studio\\node_modules\""
echo "THEN — launch:"
echo "  cd $ISO && NLS_DEV_RELOAD_PORT=5599 node project/app/dev-electron.js --cdp --cdp-port=9228"
