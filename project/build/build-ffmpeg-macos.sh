#!/usr/bin/env bash
#
# Build a self-contained, LGPL-licensed FFmpeg + ffprobe for macOS, from source.
#
# Called by project/build/prepare-ffmpeg.js, which downloads a prebuilt binary on Windows and
# Linux and calls this instead on macOS. The reason for the split is written up on the ASSETS
# table in that script: BtbN publishes no macOS asset, and every mainstream macOS FFmpeg
# distribution is GPL. Building it here is the only way to get a macOS binary this project is
# allowed to redistribute.
#
# Usage:
#   bash project/build/build-ffmpeg-macos.sh --out=<dir> [--work=<dir>] [--jobs=<n>]
#
#   --out    where ffmpeg, ffprobe and COPYING.LGPLv2.1 are written. Created if missing.
#   --work   scratch tree for downloads, sources and the staging prefix.
#            Defaults to <repo>/.dev/cache/ffmpeg-macos, which is gitignored.
#   --jobs   make parallelism. Defaults to the machine's core count.
#
# Env:
#   MACOSX_DEPLOYMENT_TARGET   defaults to 11.0; see "DEPLOYMENT TARGET" below.
#
# Exit codes:
#   0  built and every gate passed
#   3  the host cannot build at all (not macOS, or no Xcode Command Line Tools)
#   1  anything else - a download that did not verify, a compile failure, a failed gate
#
# The caller treats every non-zero exit as "skip, media conversion is unavailable"; 3 exists only
# so it can print the more useful `xcode-select --install` hint.
#
# ==================================================================================================
# NOTHING OUTSIDE --work AND --out IS WRITTEN
# ==================================================================================================
#
# No sudo, no package manager, no /usr/local. Everything - including pkg-config, which macOS does
# not ship - is built into a prefix inside --work and thrown away with it. That is not tidiness:
# a build that reaches into /opt/homebrew picks up that machine's dependency closure, and the
# resulting binary then needs a Homebrew install on the user's machine to start. PKG_CONFIG_LIBDIR
# is pinned to our own prefix for exactly that reason, and the `otool -L` gate at the end proves
# it worked.
#
# ==================================================================================================
# THE LICENCE IS THE POINT
# ==================================================================================================
#
# The configure line below is LGPL and nothing else: no --enable-gpl, no --enable-nonfree, no
# libx264/libx265/libfdk_aac. VP9 (libvpx) and Vorbis (libvorbis) are both BSD, so the project's
# transcode target loses nothing by staying LGPL.
#
# It also carries **no --enable-version3**, which the prebuilt Windows/Linux builds do. So this
# binary is **LGPL v2.1 or later** while those are LGPL v3 or later, and the two are recorded
# separately in the staged manifest.json. The licence text shipped alongside must match: this
# script copies COPYING.LGPLv2.1 out of the FFmpeg source tree, not the LGPLv3 text.
#
# ==================================================================================================
# HOST ARCHITECTURE ONLY
# ==================================================================================================
#
# Whatever `uname -m` says, and nothing else. Building x86_64 (or a universal binary) would need
# nasm to assemble libvpx's x86 SIMD, and nasm is not in the Command Line Tools - it would have to
# be built here too, or installed from a package manager this script refuses to depend on. So an
# Intel Mac builds an Intel binary and an Apple Silicon Mac builds an arm64 one; neither produces
# the other's. resources/codesign is already Apple-Silicon-only for a comparable reason (zsign
# publishes no macOS x64 asset), so the packaging side already copes with a per-arch gap.
#
# ==================================================================================================
# DEPLOYMENT TARGET
# ==================================================================================================
#
# Without MACOSX_DEPLOYMENT_TARGET, clang stamps the *build* machine's OS version into
# LC_BUILD_VERSION, and dyld refuses to launch a binary whose minimum is newer than the running
# system. A binary built on macOS 15 would then be dead on every user still on 14. 11.0 is set as
# the floor because FFmpeg, libvpx and libvorbis are plain C against long-stable APIs and none of
# them needs anything newer. Overridable, but lower it and you are on your own.
#
# ==================================================================================================
# FOUR TRAPS, ALL OF THEM HIT FOR REAL
# ==================================================================================================
#
# Each one is handled below with a comment at the point of handling. Summarised here because three
# of the four fail somewhere other than where the cause is:
#
#   1. libvorbis 1.3.7's configure injects -force_cpusubtype_ALL on darwin. It is a PowerPC-era
#      fat-binary flag with no meaning on arm64, and Xcode 16's linker rejects it outright.
#   2. --pkg-config-flags=--static is not optional. Without it the vorbis link test fails for a
#      missing -logg and FFmpeg reports "vorbis not found using pkg-config", which points at the
#      wrong thing entirely.
#   3. --enable-zlib is not optional either, because --disable-autodetect turns zlib off with
#      everything else and the PNG encoder needs it. Omitting it fails nowhere in this script -
#      only at runtime, on the first image conversion.
#   4. --enable-lzma is deliberately absent: the macOS SDK has no lzma.h and configure would fail.
#      It costs only LZMA-compressed TIFF and Matroska, which is acceptable.
#
# The functional gate at the end exists because trap 3 proved that "configured, compiled, correctly
# licensed and self-contained" is not the same as "works". It transcodes real samples the binary
# generates itself and reads the results back with the ffprobe it just built.

set -euo pipefail

# --------------------------------------------------------------------------------------------------
# Pinned sources.
#
# Every one is verified against the sha256 written here before it is unpacked. Deliberately not read
# from a checksum file published beside the tarball: a checksum fetched from the same place as the
# payload proves nothing, since whoever could re-point the tarball could re-point the checksum with
# it. Same trust anchor as prepare-ffmpeg.js and prepare-codesign-tools.js.
#
# Bumping any version here means re-running the whole gate on a real Mac. It is not a text edit.
# --------------------------------------------------------------------------------------------------

FFMPEG_VERSION="8.1.2"
FFMPEG_URL="https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz"
FFMPEG_SHA256="464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c"

LIBVPX_VERSION="1.15.0"
LIBVPX_URL="https://github.com/webmproject/libvpx/archive/refs/tags/v${LIBVPX_VERSION}.tar.gz"
LIBVPX_SHA256="e935eded7d81631a538bfae703fd1e293aad1c7fd3407ba00440c95105d2011e"

LIBVORBIS_VERSION="1.3.7"
LIBVORBIS_URL="https://downloads.xiph.org/releases/vorbis/libvorbis-${LIBVORBIS_VERSION}.tar.gz"
LIBVORBIS_SHA256="0e982409a9c3fc82ee06e08205b1355e5c6aa4c36bca58146ef399621b0ce5ab"

LIBOGG_VERSION="1.3.5"
LIBOGG_URL="https://downloads.xiph.org/releases/ogg/libogg-${LIBOGG_VERSION}.tar.gz"
LIBOGG_SHA256="0eb4b4b9420a0f51db142ba3f9c64b333f826532dc0f48c6410ae51f4799b664"

PKGCONFIG_VERSION="0.29.2"
PKGCONFIG_URL="https://pkg-config.freedesktop.org/releases/pkg-config-${PKGCONFIG_VERSION}.tar.gz"
PKGCONFIG_SHA256="6fc69c01688c9458a57eb9a1664c9aba372ccda420a02bf4429fe610e7e7d591"

# Configure flags that must never appear in the finished binary. Checked against `ffmpeg -buildconf`
# at the end, which reads the string FFmpeg embeds in itself rather than trusting this file's word
# for what it asked for.
#
# The `--enable-` prefix is part of each pattern and not an accident: matching the bare name would
# also fire on a `--disable-libx264`, which is the *correct* state written explicitly. A gate that
# fails on someone documenting their intent is a gate people learn to delete.
FORBIDDEN_FLAGS=(
    "--enable-gpl"          # relicenses the whole installer
    "--enable-nonfree"      # not redistributable at all
    "--enable-version3"     # would make this LGPL v3, and the shipped licence text says 2.1
    "--enable-libx264"      # GPL
    "--enable-libx265"      # GPL
    "--enable-libfdk"       # nonfree (matches --enable-libfdk-aac)
)

# --------------------------------------------------------------------------------------------------
# Plumbing
# --------------------------------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

OUT_DIR=""
WORK_DIR=""
JOBS=""

for arg in "$@"; do
    case "$arg" in
        --out=*)  OUT_DIR="${arg#--out=}" ;;
        --work=*) WORK_DIR="${arg#--work=}" ;;
        --jobs=*) JOBS="${arg#--jobs=}" ;;
        *)
            printf 'build-ffmpeg-macos: unknown argument "%s"\n' "$arg" >&2
            exit 1
            ;;
    esac
done

if [ -z "$OUT_DIR" ]; then
    printf 'build-ffmpeg-macos: --out=<dir> is required\n' >&2
    exit 1
fi

WORK_DIR="${WORK_DIR:-${REPO_ROOT}/.dev/cache/ffmpeg-macos}"

log()  { printf '[ffmpeg-macos] %s\n' "$*"; }
step() { printf '[ffmpeg-macos] -- %s\n' "$*"; }
die()  { printf '[ffmpeg-macos] FAILED: %s\n' "$*" >&2; exit 1; }

# --------------------------------------------------------------------------------------------------
# Host preflight. Exits 3 - "this machine cannot build it" - which the caller turns into a skip with
# an actionable hint, not into a failed Studio build.
# --------------------------------------------------------------------------------------------------

if [ "$(uname -s)" != "Darwin" ]; then
    printf '[ffmpeg-macos] not macOS (uname -s = %s); nothing to build here\n' "$(uname -s)" >&2
    exit 3
fi

if ! xcode-select -p >/dev/null 2>&1 || ! xcrun --find clang >/dev/null 2>&1; then
    printf '[ffmpeg-macos] no Xcode Command Line Tools on this machine (run: xcode-select --install)\n' >&2
    exit 3
fi

for tool in curl tar make sed awk shasum install lipo otool; do
    command -v "$tool" >/dev/null 2>&1 || die "required tool \"$tool\" is not on PATH"
done

HOST_ARCH="$(uname -m)"
JOBS="${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-11.0}"

DL_DIR="${WORK_DIR}/downloads"
SRC_DIR="${WORK_DIR}/src"
PREFIX="${WORK_DIR}/prefix"
LOG_DIR="${WORK_DIR}/logs"
GATE_DIR="${WORK_DIR}/gate"

# The prefix is rebuilt from scratch every run. Half of a previous run's prefix - say a libvorbis
# that installed its headers before the link step failed - is exactly the state that makes a later
# run succeed for the wrong reasons. Downloads and unpacked sources are kept, because they are
# checksum-verified and re-fetching them is pure cost.
rm -rf "$PREFIX" "$GATE_DIR" "$LOG_DIR"
mkdir -p "$DL_DIR" "$SRC_DIR" "$PREFIX" "$LOG_DIR" "$GATE_DIR" "$OUT_DIR"

export PATH="${PREFIX}/bin:${PATH}"
# Pinned rather than prepended: with only our own prefix visible, configure physically cannot find
# a Homebrew .pc file and link against /opt/homebrew. See "NOTHING OUTSIDE --work" above.
export PKG_CONFIG_LIBDIR="${PREFIX}/lib/pkgconfig"
export PKG_CONFIG_PATH="${PREFIX}/lib/pkgconfig"

# Xcode 15 promoted implicit-function-declaration and int-conversion from warnings to errors. These
# three tarballs predate that by a decade and trip it in their autoconf probes; the flags are inert
# on code that already compiles clean. Passed per-package, never exported, so the FFmpeg build gets
# the compiler's stock behaviour.
LEGACY_C_FLAGS="-Wno-implicit-function-declaration -Wno-int-conversion"

# --------------------------------------------------------------------------------------------------
# run_logged <name> <command...>
#
# This is the answer to "a dependency failed and the script carried on to FFmpeg anyway". Under
# `set -e` a bare command would already abort, but output goes to a log file to keep the console
# readable, and a swallowed log is how a failure goes unnoticed. So: on failure, print the tail of
# the log and exit non-zero, unconditionally. Every build step goes through here, and every step is
# followed by an explicit check that the artefact it was supposed to produce actually exists.
# --------------------------------------------------------------------------------------------------
run_logged() {
    local name="$1"
    shift
    local log="${LOG_DIR}/${name}.log"
    printf '[ffmpeg-macos]    %s\n' "$name"
    if ! "$@" >"$log" 2>&1; then
        printf '\n[ffmpeg-macos] FAILED: %s (full log: %s)\n' "$name" "$log" >&2
        printf '[ffmpeg-macos] last 40 lines:\n' >&2
        tail -n 40 "$log" >&2 || true
        # FFmpeg's configure reports the *symptom* on the console and the *cause* only here. Trap 2
        # is the reason this branch exists at all: "vorbis not found using pkg-config" on the
        # console, "undefined symbol _oggpack_writetrunc" in config.log.
        if [ -f "${SRC_DIR}/ffmpeg-${FFMPEG_VERSION}/ffbuild/config.log" ] && [[ "$name" == ffmpeg-* ]]; then
            printf '\n[ffmpeg-macos] last 60 lines of ffbuild/config.log (the real error usually lives here):\n' >&2
            tail -n 60 "${SRC_DIR}/ffmpeg-${FFMPEG_VERSION}/ffbuild/config.log" >&2 || true
        fi
        exit 1
    fi
}

require_file() {
    [ -f "$1" ] || die "${2:-expected file} is missing: $1"
}

# fetch <url> <sha256> <filename>
#
# Cached in --work, but re-verified on every run even when cached: a truncated download that was
# interrupted after the rename, or a file someone edited by hand, must not survive into a build.
fetch() {
    local url="$1" want="$2" name="$3"
    local dest="${DL_DIR}/${name}"
    if [ ! -f "$dest" ]; then
        printf '[ffmpeg-macos]    fetching %s\n' "$name"
        # Downloaded to .part and renamed, so an interrupted transfer is never mistaken for a cache
        # hit on the next run.
        curl -fsSL --retry 3 --retry-delay 2 -o "${dest}.part" "$url" \
            || die "could not download ${url}"
        mv "${dest}.part" "$dest"
    fi
    local got
    got="$(shasum -a 256 "$dest" | awk '{print $1}')"
    if [ "$got" != "$want" ]; then
        rm -f "$dest"
        printf '[ffmpeg-macos] FAILED: checksum mismatch for %s\n  expected %s\n  actual   %s\n' \
            "$url" "$want" "$got" >&2
        printf '[ffmpeg-macos] the cached copy has been deleted; if this repeats, upstream changed the bytes\n' >&2
        exit 1
    fi
}

# unpack <filename> <expected-directory-name>
unpack() {
    local name="$1" dir="$2"
    rm -rf "${SRC_DIR:?}/${dir}"
    # bsdtar (the system tar) reads .tar.gz and .tar.xz without help, which is why there is no
    # xz dependency here the way prepare-ffmpeg.js needs 7za on Windows.
    tar -xf "${DL_DIR}/${name}" -C "$SRC_DIR" || die "could not unpack ${name}"
    [ -d "${SRC_DIR}/${dir}" ] || die "${name} did not unpack to the expected directory ${dir}"
}

BUILD_STARTED_AT="$(date +%s)"

log "building FFmpeg ${FFMPEG_VERSION} for darwin-${HOST_ARCH} (deployment target ${MACOSX_DEPLOYMENT_TARGET})"
log "work dir: ${WORK_DIR}"
log "this takes roughly 3-5 minutes on an M1 and is mostly silent; per-step logs are under ${LOG_DIR}"

# --------------------------------------------------------------------------------------------------
# 1. pkg-config
#
# macOS ships none, and FFmpeg's --enable-libvpx / --enable-libvorbis checks are pkg-config based.
# --with-internal-glib because there is no system glib either, and pulling one in would be exactly
# the dependency closure this script exists to avoid.
# --------------------------------------------------------------------------------------------------
step "pkg-config ${PKGCONFIG_VERSION}"
fetch "$PKGCONFIG_URL" "$PKGCONFIG_SHA256" "pkg-config-${PKGCONFIG_VERSION}.tar.gz"
unpack "pkg-config-${PKGCONFIG_VERSION}.tar.gz" "pkg-config-${PKGCONFIG_VERSION}"
(
    cd "${SRC_DIR}/pkg-config-${PKGCONFIG_VERSION}"
    run_logged "pkgconfig-configure" env CFLAGS="$LEGACY_C_FLAGS" ./configure \
        --prefix="$PREFIX" \
        --with-internal-glib \
        --disable-host-tool \
        --disable-shared
    run_logged "pkgconfig-make" make -j"$JOBS"
    run_logged "pkgconfig-install" make install
)
require_file "${PREFIX}/bin/pkg-config" "pkg-config"

# --------------------------------------------------------------------------------------------------
# 2. libogg - Vorbis's container/bitpacker, and a hard dependency of libvorbis.
# --------------------------------------------------------------------------------------------------
step "libogg ${LIBOGG_VERSION}"
fetch "$LIBOGG_URL" "$LIBOGG_SHA256" "libogg-${LIBOGG_VERSION}.tar.gz"
unpack "libogg-${LIBOGG_VERSION}.tar.gz" "libogg-${LIBOGG_VERSION}"
(
    cd "${SRC_DIR}/libogg-${LIBOGG_VERSION}"
    run_logged "libogg-configure" env CFLAGS="$LEGACY_C_FLAGS" ./configure \
        --prefix="$PREFIX" \
        --disable-shared \
        --enable-static
    run_logged "libogg-make" make -j"$JOBS"
    run_logged "libogg-install" make install
)
require_file "${PREFIX}/lib/libogg.a" "static libogg"
require_file "${PREFIX}/lib/pkgconfig/ogg.pc" "ogg.pc"

# --------------------------------------------------------------------------------------------------
# 3. libvorbis
#
# TRAP 1. libvorbis 1.3.7's configure has, in its `*-*-darwin*` branch, a hardcoded
# -force_cpusubtype_ALL. That is a PowerPC-era fat-binary assembler/linker flag; it means nothing on
# arm64 and Xcode 16's linker rejects it outright with `ld: unknown options: -force_cpusubtype_ALL`.
# The fix is to strip it before configure runs.
#
# `sed -i ""` is BSD syntax - correct here, since this file only ever runs on macOS, and wrong
# everywhere else (GNU sed would read "" as the next script). The assertion after it is the part
# that matters: sed is perfectly happy to match nothing and exit 0, and a silent no-op here would
# hand the failure to the linker several minutes later looking like a compiler problem.
# --------------------------------------------------------------------------------------------------
step "libvorbis ${LIBVORBIS_VERSION}"
fetch "$LIBVORBIS_URL" "$LIBVORBIS_SHA256" "libvorbis-${LIBVORBIS_VERSION}.tar.gz"
unpack "libvorbis-${LIBVORBIS_VERSION}.tar.gz" "libvorbis-${LIBVORBIS_VERSION}"
(
    cd "${SRC_DIR}/libvorbis-${LIBVORBIS_VERSION}"

    grep -q -- "-force_cpusubtype_ALL" configure \
        || die "libvorbis ${LIBVORBIS_VERSION}'s configure no longer contains -force_cpusubtype_ALL; \
the patch below is stale - re-check the darwin branch of its configure before removing this guard"
    sed -i "" "s/-force_cpusubtype_ALL//g" configure
    # `if` rather than `grep ... && die`: under `set -e` an AND-list whose left side fails takes the
    # list's status with it, so the good path (grep finds nothing) would abort the script silently.
    if grep -q -- "-force_cpusubtype_ALL" configure; then
        die "the -force_cpusubtype_ALL patch did not apply; Xcode's linker would reject the build"
    fi

    run_logged "libvorbis-configure" env CFLAGS="$LEGACY_C_FLAGS" ./configure \
        --prefix="$PREFIX" \
        --with-ogg="$PREFIX" \
        --disable-shared \
        --enable-static
    run_logged "libvorbis-make" make -j"$JOBS"
    run_logged "libvorbis-install" make install
)
require_file "${PREFIX}/lib/libvorbis.a" "static libvorbis"
require_file "${PREFIX}/lib/libvorbisenc.a" "static libvorbisenc"
require_file "${PREFIX}/lib/pkgconfig/vorbis.pc" "vorbis.pc"

# --------------------------------------------------------------------------------------------------
# 4. libvpx - the VP9 encoder.
#
# No --target is given: libvpx detects the host, and on arm64 it assembles its SIMD with clang and
# needs no external assembler. That is precisely why this script is host-arch-only; an x86_64 target
# would want nasm. See "HOST ARCHITECTURE ONLY" above.
# --------------------------------------------------------------------------------------------------
step "libvpx ${LIBVPX_VERSION}"
fetch "$LIBVPX_URL" "$LIBVPX_SHA256" "libvpx-${LIBVPX_VERSION}.tar.gz"
unpack "libvpx-${LIBVPX_VERSION}.tar.gz" "libvpx-${LIBVPX_VERSION}"
(
    cd "${SRC_DIR}/libvpx-${LIBVPX_VERSION}"
    run_logged "libvpx-configure" ./configure \
        --prefix="$PREFIX" \
        --disable-shared \
        --enable-static \
        --enable-pic \
        --enable-vp9-encoder \
        --disable-examples \
        --disable-tools \
        --disable-docs \
        --disable-unit-tests
    run_logged "libvpx-make" make -j"$JOBS"
    run_logged "libvpx-install" make install
)
require_file "${PREFIX}/lib/libvpx.a" "static libvpx"
require_file "${PREFIX}/lib/pkgconfig/vpx.pc" "vpx.pc"

# --------------------------------------------------------------------------------------------------
# 5. FFmpeg
#
# The configure line is the verified one. Read the flags before changing any of them:
#
#   --pkg-config-flags=--static   TRAP 2. Static libvorbis puts -logg in vorbis.pc's Libs.private,
#                                 which pkg-config only emits with --static. Without this the vorbis
#                                 link test dies on an undefined _oggpack_writetrunc and configure
#                                 announces "ERROR: vorbis not found using pkg-config" - which sends
#                                 you looking at PKG_CONFIG_PATH, where nothing is wrong. The real
#                                 message is in ffbuild/config.log; run_logged prints its tail.
#   --disable-autodetect          nothing gets linked in because it happened to be on the machine.
#                                 Every dependency is explicit, so the binary's contents are a
#                                 property of this file rather than of the build host.
#   --enable-zlib                 TRAP 3. --disable-autodetect switches zlib off along with
#                                 everything else, and the PNG encoder needs it. Drop this flag and
#                                 configure succeeds, make succeeds, the licence is right, the
#                                 binary is self-contained, VP9 and AAC both work - and image
#                                 conversion fails at runtime with `Unknown encoder 'png'`. Gate 5
#                                 below is what turns that into a build failure instead.
#   --disable-network             Studio hands FFmpeg local files only. Turning the protocols off
#                                 means a crafted input cannot make it open a socket.
#   --enable-static/--disable-shared, --disable-doc/--disable-debug/--disable-ffplay
#                                 one self-contained binary each, no dylibs to stage, no ffplay.
#
# Deliberately NOT here - TRAP 4: --enable-lzma. The macOS SDK ships no lzma.h and configure fails
# with "lzma requested but not found". It costs LZMA-compressed TIFF and Matroska, which are rare
# enough to accept.
#
# No --prefix and no `make install`: the two binaries are lifted straight out of the build tree, so
# this stage writes nothing outside --work either.
# --------------------------------------------------------------------------------------------------
step "ffmpeg ${FFMPEG_VERSION}"
fetch "$FFMPEG_URL" "$FFMPEG_SHA256" "ffmpeg-${FFMPEG_VERSION}.tar.xz"
unpack "ffmpeg-${FFMPEG_VERSION}.tar.xz" "ffmpeg-${FFMPEG_VERSION}"
(
    cd "${SRC_DIR}/ffmpeg-${FFMPEG_VERSION}"
    run_logged "ffmpeg-configure" ./configure \
        --pkg-config-flags=--static \
        --disable-autodetect \
        --disable-network \
        --disable-shared \
        --enable-static \
        --disable-doc \
        --disable-debug \
        --disable-ffplay \
        --enable-pthreads \
        --enable-zlib \
        --enable-libvpx \
        --enable-libvorbis
    run_logged "ffmpeg-make" make -j"$JOBS"
)

FFMPEG_BIN="${SRC_DIR}/ffmpeg-${FFMPEG_VERSION}/ffmpeg"
FFPROBE_BIN="${SRC_DIR}/ffmpeg-${FFMPEG_VERSION}/ffprobe"
require_file "$FFMPEG_BIN" "the built ffmpeg"
require_file "$FFPROBE_BIN" "the built ffprobe"
require_file "${SRC_DIR}/ffmpeg-${FFMPEG_VERSION}/COPYING.LGPLv2.1" "the LGPLv2.1 licence text"

# ==================================================================================================
# GATES
#
# Everything below runs against the binaries that were just built, and any failure exits non-zero.
# Nothing is staged unless all of it passes.
# ==================================================================================================

fail_gate() { printf '[ffmpeg-macos] GATE FAILED: %s\n' "$*" >&2; exit 1; }

# ---- Architecture --------------------------------------------------------------------------------
step "gate: architecture"
for bin in "$FFMPEG_BIN" "$FFPROBE_BIN"; do
    archs="$(lipo -archs "$bin")"
    [ "$archs" = "$HOST_ARCH" ] \
        || fail_gate "$(basename "$bin") is \"${archs}\", expected the host's \"${HOST_ARCH}\""
done

# ---- Licence -------------------------------------------------------------------------------------
#
# Two independent checks. `-L` is what FFmpeg says its licence is; `-buildconf` is the configure line
# it was actually built from. The first is the claim, the second is the evidence. Both are read off
# the binary rather than off this script's variables, so a future edit to the configure line above
# cannot quietly relicense the output.
#
# Note the version3 check inside FORBIDDEN_FLAGS: its absence is exactly what makes this build LGPL
# v2.1-or-later rather than the v3-or-later of the prebuilt Windows/Linux binaries, and it is why
# COPYING.LGPLv2.1 is the correct text to ship beside it.
step "gate: licence"
license_text="$("$FFMPEG_BIN" -hide_banner -L 2>&1 || true)"
case "$license_text" in
    *"Lesser General Public License"*) : ;;
    *) fail_gate "ffmpeg -L does not report an LGPL licence:
${license_text}" ;;
esac
case "$license_text" in
    *"2.1"*) : ;;
    *) fail_gate "ffmpeg -L does not report LGPL version 2.1; the shipped COPYING.LGPLv2.1 would be the wrong text:
${license_text}" ;;
esac

buildconf="$("$FFMPEG_BIN" -hide_banner -buildconf 2>&1 || true)"
for flag in "${FORBIDDEN_FLAGS[@]}"; do
    if printf '%s' "$buildconf" | grep -q -- "$flag"; then
        fail_gate "the build carries \"${flag}\", which this project may not redistribute"
    fi
done
for flag in "--enable-libvpx" "--enable-libvorbis" "--enable-zlib"; do
    printf '%s' "$buildconf" | grep -q -- "$flag" \
        || fail_gate "the build is missing \"${flag}\"; see the configure notes above"
done

# ---- Self-containment ----------------------------------------------------------------------------
#
# Every dylib must come from the OS. Anything under /opt or /usr/local means a Homebrew library got
# linked in and the binary would not start on a machine without it.
step "gate: self-contained"
for bin in "$FFMPEG_BIN" "$FFPROBE_BIN"; do
    while IFS= read -r dylib; do
        case "$dylib" in
            /usr/lib/*|/System/*) : ;;
            *) fail_gate "$(basename "$bin") links a non-system library: ${dylib}" ;;
        esac
    done < <(otool -L "$bin" | tail -n +2 | awk '{print $1}')
done

# ---- Function ------------------------------------------------------------------------------------
#
# The gate trap 3 bought. Samples are generated by the binary under test via -f lavfi, so this needs
# no fixture files and cannot pass because someone's sample happened to be transcodable already.
#
# The source is deliberately NOT VP9/Vorbis: it is mpeg4 + aac in mp4, so gates 1 and 2 are real
# re-encodes rather than a remux that would pass without libvpx or libvorbis linked at all.
step "gate: function"

probe_codec() {
    # <file> <stream-spec> -> the codec_name, or empty.
    # `|| true` so that a failed probe yields an empty string and the caller's own comparison reports
    # it as a gate failure, instead of `set -e` killing the script with no explanation.
    "$FFPROBE_BIN" -v error -select_streams "$2" \
        -show_entries stream=codec_name -of default=nw=1:nk=1 "$1" 2>/dev/null | head -n 1 || true
}

ff() {
    "$FFMPEG_BIN" -hide_banner -nostdin -loglevel error -y "$@"
}

SOURCE="${GATE_DIR}/source.mp4"
ff -f lavfi -i "testsrc2=size=320x240:rate=15:duration=2" \
   -f lavfi -i "sine=frequency=440:duration=2" \
   -c:v mpeg4 -c:a aac -shortest "$SOURCE" \
   || fail_gate "could not synthesise the gate's source clip"
require_file "$SOURCE" "the gate's source clip"

# Gate 1 + 2: the project's video target - VP9 video, Vorbis audio, in WebM.
# -cpu-used 5 only makes libvpx quicker; the gate is about which encoder ran, not how well.
WEBM="${GATE_DIR}/out.webm"
ff -i "$SOURCE" -c:v libvpx-vp9 -b:v 0 -crf 40 -cpu-used 5 -c:a libvorbis -q:a 4 "$WEBM" \
    || fail_gate "re-encoding to VP9 + Vorbis failed"
got="$(probe_codec "$WEBM" "v:0")"
[ "$got" = "vp9" ] || fail_gate "gate 1: re-encoded video is \"${got}\", expected vp9"
got="$(probe_codec "$WEBM" "a:0")"
[ "$got" = "vorbis" ] || fail_gate "gate 2: re-encoded audio is \"${got}\", expected vorbis"

# Gate 3: the audio-only target. FFmpeg's native AAC encoder, muxed by adts - not libfdk_aac, which
# is nonfree and is in FORBIDDEN_FLAGS above.
AAC="${GATE_DIR}/out.aac"
ff -i "$SOURCE" -vn -c:a aac -b:a 192k -f adts "$AAC" \
    || fail_gate "re-encoding to AAC failed"
got="$(probe_codec "$AAC" "a:0")"
[ "$got" = "aac" ] || fail_gate "gate 3: re-encoded audio is \"${got}\", expected aac"

# Gate 4: remux. `-c copy` must move the streams into a new container without touching them, so the
# assertion is that the codecs match the SOURCE's - read back, not hardcoded, because "unchanged" is
# the property under test.
REMUX="${GATE_DIR}/remux.mkv"
ff -i "$WEBM" -c copy "$REMUX" || fail_gate "remuxing with -c copy failed"
for stream in "v:0" "a:0"; do
    before="$(probe_codec "$WEBM" "$stream")"
    after="$(probe_codec "$REMUX" "$stream")"
    [ -n "$after" ] && [ "$before" = "$after" ] \
        || fail_gate "gate 4: stream ${stream} was \"${before}\" and is \"${after}\" after a -c copy remux"
done

# Gate 5: the image path. This is the one --enable-zlib exists for, and the only gate that would
# have caught its absence.
PNG="${GATE_DIR}/out.png"
ff -i "$SOURCE" -map 0:v:0 -frames:v 1 -c:v png -update 1 "$PNG" \
    || fail_gate "gate 5: encoding a PNG failed - if this says \"Unknown encoder 'png'\", --enable-zlib is missing"
got="$(probe_codec "$PNG" "v:0")"
[ "$got" = "png" ] || fail_gate "gate 5: encoded image is \"${got}\", expected png"

# ==================================================================================================
# Stage
# ==================================================================================================

step "staging into ${OUT_DIR}"
install -m 755 "$FFMPEG_BIN" "${OUT_DIR}/ffmpeg"
install -m 755 "$FFPROBE_BIN" "${OUT_DIR}/ffprobe"
install -m 644 "${SRC_DIR}/ffmpeg-${FFMPEG_VERSION}/COPYING.LGPLv2.1" "${OUT_DIR}/COPYING.LGPLv2.1"

elapsed=$(( $(date +%s) - BUILD_STARTED_AT ))
minos="$(otool -l "${OUT_DIR}/ffmpeg" | awk '/LC_BUILD_VERSION/{f=1} f && $1=="minos" {print $2; exit}')"

log "done in $((elapsed / 60))m $((elapsed % 60))s"
log "  ffmpeg   $(du -h "${OUT_DIR}/ffmpeg" | awk '{print $1}')  ${HOST_ARCH}  minos ${minos:-unknown}"
log "  ffprobe  $(du -h "${OUT_DIR}/ffprobe" | awk '{print $1}')  ${HOST_ARCH}"
log "  licence  LGPL-2.1-or-later (COPYING.LGPLv2.1)"
