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
# ...and yarn 4 also refuses with "Couldn't find the node_modules state file" unless this comes
# along, which only bites the commands run THROUGH yarn (`yarn lint`, `yarn build:*`). Launching
# with `node project/app/dev-electron.js` directly never needed it, so it stayed missing until a
# card audit tried to build in one of these trees.
mkdir -p "$ISO/.yarn"
[ -f .yarn/install-state.gz ] && cp .yarn/install-state.gz "$ISO/.yarn/"

# THE PROJECT COPY IS NOW MUTABLE BY A RUN. Restore it between rounds the same way the profile is.
# Until the data-safety card landed, an accidental edit made by a probe almost never reached disk —
# the autosave was a pure 800ms trailing debounce with no ceiling and no flush on shutdown, and an
# acceptance run kills the app. With atomic writes, a ~5s ceiling and a shutdown flush, it does.
# It already happened: a stray keystroke from a probe appended a text run to a dialogue row, the
# autosave dutifully saved it, and the next run read `OK au` where the story says `OK {a}` — which
# surfaced as a red assertion about the timeline dropping an inline variable reference. Nothing was
# wrong with the app. Keep a pristine copy of the project and restore from it, e.g.
#   NLS_VERIFY_PROJECT=/d/Temp/nls-u4-proj/demo3  restored from  /d/Temp/nls-u4-proj-pristine
#
# A fresh profile every round: probes leave selected rows and open tabs behind, and a state that
# has been probed can no longer reproduce "nothing selected". Seeded by COPYING the
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
echo "THEN — launch (the occlusion switch is required; without it the visibility guard fails and"
echo "        acceptance would have to steal the operator's foreground to pass):"
echo "  cd $ISO && NLS_DEV_RELOAD_PORT=5599 node project/app/dev-electron.js --cdp --cdp-port=9228 --disable-features=CalculateNativeWinOcclusion"
