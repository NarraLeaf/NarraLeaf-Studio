#!/usr/bin/env bash
#
# Assert the vendored FFmpeg tools are inside the installer that was just built.
#
# Run by the packaging jobs in .github/workflows/{ci,release}.yml, straight after electron-builder
# and before the artefacts are uploaded.
#
# ==================================================================================================
# WHY THIS EXISTS SEPARATELY FROM prepare-ffmpeg.js
# ==================================================================================================
#
# Getting the binaries into resources/ and getting them into the installer are two different steps
# with two different owners. The first is prepare-ffmpeg.js, and NLS_REQUIRE_FFMPEG makes it fail
# loudly on a packaging run. The second is electron-builder's per-platform `extraResources` block in
# electron-builder.yml, which logs "file source doesn't exist" and carries on - by design, so that a
# Mac without Command Line Tools can still package Studio. On a run that produces something people
# download, that tolerance is exactly the wrong one, and nothing else notices.
#
# So this reads the artefact rather than the tree it was built from.
#
# macOS opens the DMG, because that is the file an author downloads, and because the macOS binary is
# the one this project compiles from source on the runner rather than downloading - if a toolchain
# ever produces something build-ffmpeg-macos.sh's own gates let through, this is the last place it
# can show up. Windows checks win-unpacked, which is the directory NSIS packs verbatim: unpacking
# the .exe would need a tool to be right about NSIS's compression, and that hop would mostly be
# testing the tool.
#
# Usage:
#   bash project/build/verify-packaged-ffmpeg.sh [--build-dir=build]

set -euo pipefail

BUILD_DIR="build"
for arg in "$@"; do
    case "$arg" in
        --build-dir=*) BUILD_DIR="${arg#--build-dir=}" ;;
        *)
            printf 'verify-packaged-ffmpeg: unknown argument "%s"\n' "$arg" >&2
            exit 1
            ;;
    esac
done

# `::error::` is GitHub's annotation prefix, which surfaces the line on the run summary instead of
# leaving it in a log nobody opens. Harmless anywhere else.
fail() { printf '::error::%s\n' "$*" >&2; exit 1; }
ok()   { printf '[verify-ffmpeg] %s\n' "$*"; }

# <dir> <file>...
require_files() {
    local dir="$1"
    shift
    for file in "$@"; do
        [ -s "${dir}/${file}" ] || fail "${file} is missing or empty in the packaged app (${dir})"
    done
}

case "$(uname -s)" in
    Darwin)
        dmg="$(find "$BUILD_DIR" -maxdepth 1 -name '*.dmg' | head -n 1)"
        [ -n "$dmg" ] || fail "no .dmg was produced in ${BUILD_DIR}"

        mount="$(mktemp -d)"
        hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mount" >/dev/null \
            || fail "could not open ${dmg}"
        # Detach on every exit path, including the failures below, so a later step does not inherit
        # a mounted image.
        trap 'hdiutil detach "$mount" >/dev/null 2>&1 || true' EXIT

        dir="$(find "$mount" -type d -path '*/Contents/Resources/resources/ffmpeg/darwin' | head -n 1)"
        [ -n "$dir" ] || fail "$(basename "$dmg") carries no resources/ffmpeg/darwin"
        require_files "$dir" ffmpeg ffprobe LICENSE manifest.json

        archs="$(lipo -archs "${dir}/ffmpeg")"
        [ "$archs" = "arm64" ] || fail "the shipped ffmpeg is \"${archs}\", not arm64"

        # Run the copy that ships, not the one in resources/. A binary that will not start here is
        # one that would not start for an author, and `-L` is also the licence claim: this build is
        # LGPL v2.1, and the text staged beside it is COPYING.LGPLv2.1.
        #
        # Two separate checks, exactly as build-ffmpeg-macos.sh does them, and NOT one glob asking
        # for both in order. `-L` prints the licence preamble hard-wrapped at ~70 columns, so
        # "Lesser General Public" and "License" fall on either side of a newline in the sentence
        # that carries the version, and the only unbroken "Lesser General Public License" is further
        # down - after the "version 2.1" it would have to precede. A combined pattern therefore
        # fails on a binary that is perfectly correct, which is what it did on the first run.
        license="$("${dir}/ffmpeg" -hide_banner -L 2>&1 || true)"
        case "$license" in
            *"Lesser General Public License"*) : ;;
            *) fail "the shipped ffmpeg does not report an LGPL licence: ${license}" ;;
        esac
        case "$license" in
            *"version 2.1 of the License"*) : ;;
            *) fail "the shipped ffmpeg does not report LGPL version 2.1, but COPYING.LGPLv2.1 is what ships beside it: ${license}" ;;
        esac

        ok "$(basename "$dmg") carries a working arm64 LGPL-2.1 ffmpeg"
        ;;
    *)
        dir="${BUILD_DIR}/win-unpacked/resources/resources/ffmpeg/win32"
        [ -d "$dir" ] || fail "the packaged app carries no ${dir}"
        require_files "$dir" ffmpeg.exe ffprobe.exe LICENSE manifest.json
        ok "win-unpacked carries ffmpeg.exe and ffprobe.exe"
        ;;
esac

cat "${dir}/manifest.json"
