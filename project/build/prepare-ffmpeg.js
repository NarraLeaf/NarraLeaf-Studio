#!/usr/bin/env node

/*
 * Stage the vendored FFmpeg tools into resources/, from where electron-builder's per-platform
 * extraResources copies them into the packaged Studio. Two binaries: ffprobe, which reads what is
 * inside a media file, and ffmpeg, which converts it.
 *
 * Same discipline as prepare-codesign-tools.js, and the same reasoning: the payload is fetched
 * while *Studio* is being built, never on the author's machine. An author importing a video must
 * not be waiting on a download and must not need a toolchain installed. So this script carries the
 * trust anchor itself - the sha256 of every asset is written down here and verified before
 * anything is unpacked. Deliberately not read from a checksum file published beside the asset: a
 * checksum fetched from the same place as the payload proves nothing, since whoever could
 * re-point the asset could re-point the checksum with it.
 *
 * Layout produced (one platform per run, the host's unless --platform says otherwise):
 *
 *   resources/ffmpeg/<platform>/ffmpeg[.exe]     the converter
 *   resources/ffmpeg/<platform>/ffprobe[.exe]    the inspector
 *   resources/ffmpeg/<platform>/LICENSE          upstream LGPLv3 notice, taken from inside the
 *                                                archive; we redistribute the binaries, so the
 *                                                notice ships next to them
 *   resources/ffmpeg/<platform>/manifest.json    what was staged, so a second run is a no-op
 *
 * Usage:
 *   node project/build/prepare-ffmpeg.js
 *   node project/build/prepare-ffmpeg.js --platform=linux   # cross-stage
 *
 * Env:
 *   NLS_SKIP_FFMPEG=1  skip entirely (offline development builds). The resulting Studio reports
 *                      media conversion as unavailable rather than failing to build.
 *
 * ============================================================================================
 * THE LICENCE IS THE HARD CONSTRAINT
 * ============================================================================================
 *
 * Only an **LGPL** build may be staged. A GPL build - the kind configured with `--enable-gpl` and
 * carrying libx264/libx265 - would put the whole installer under the GPL, and that is a
 * distribution decision, not a build detail. It is not something this script, or anyone editing
 * it, gets to make on the project's behalf.
 *
 * That is not left to the asset's file name. `assertLgplBuild` below scans the staged bytes for
 * the configure string FFmpeg embeds in every binary and refuses anything carrying `--enable-gpl`
 * or `--enable-nonfree`. The file name saying "lgpl" is a claim; the configure string is evidence.
 *
 * The transcode target - VP9 video, Vorbis audio - needs libvpx and libvorbis, both BSD, so an
 * LGPL build loses nothing. Their presence is asserted too, because a build without them would
 * stage cleanly and then fail at the first conversion.
 *
 * `--enable-version3` is set upstream, so the effective licence is **LGPL v3**, and the archive's
 * LICENSE.txt is the LGPLv3 text. Two obligations follow and are not discharged by this script:
 * the notice must reach the user (it ships beside the binaries, which covers it) and a written
 * offer for the corresponding FFmpeg source must be made. The second belongs in Studio's about /
 * third-party notices, not here.
 *
 * ============================================================================================
 * WHY THIS TAG
 * ============================================================================================
 *
 * BtbN/FFmpeg-Builds publishes daily `autobuild-YYYY-MM-DD-HH-MM` releases and prunes them. As
 * measured on 2026-08-06, 37 releases survive: the last ~14 days, plus **the final build of every
 * month** going back to 2024-09. So a month-end tag is stable for roughly two years and a
 * mid-month one disappears in a fortnight. This pin is a month-end build for exactly that reason.
 *
 * The `latest` tag must never be pinned: its assets are replaced in place, so the sha256 below
 * would start failing the moment upstream rebuilt.
 *
 * ============================================================================================
 * SIZE - READ BEFORE CHANGING THE VARIANT
 * ============================================================================================
 *
 * These are the *static* builds, which is why the resolver in src/main is a plain file lookup with
 * no load-path handling. They are not small. Measured from this exact tag (win64):
 *
 *   static  (`-lgpl`)         ffmpeg.exe 113.5 MB + ffprobe.exe 113.3 MB  = ~217 MiB staged
 *   shared  (`-lgpl-shared`)  two small exes + 36 DLLs                    = ~138 MiB staged
 *
 * The shared variant is self-contained too - those are FFmpeg's own libraries, not the host's - so
 * the objection that ruled out shared builds for zsign does not apply here, and it is the lever to
 * pull if installer size becomes the problem. It costs a per-platform layout (`bin/` beside `lib/`
 * on Linux, DLLs beside the exes on Windows) that the resolver would have to learn.
 */

const { execFileSync } = require('child_process');
const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');
const { path7za } = require('7zip-bin');
const { rootDir } = require('./utils');

/** Upstream build we vendor. Mirrored by FFMPEG_VERSION in src/main/app/application/managers/media/ffmpegTool.ts. */
const FFMPEG_VERSION = 'n8.1.2-34-g9b6c8969e0';
const BUILD_TAG = 'autobuild-2026-07-31-14-10';
const RELEASE_BASE = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${BUILD_TAG}/`;

/** The LGPLv3 text shipped inside both archives. Identical byte-for-byte across platforms. */
const LICENSE_SHA256 = 'da7eabb7bafdf7d3ae5e9f223aa5bdc1eece45ac569dc21b3b037520b4464768';

/**
 * Which asset serves which host, keyed by process.platform.
 *
 * `dir` is the directory name inside the archive - it embeds the version, so it moves with the pin
 * and is written here rather than derived, since a wrong guess would fail deep inside 7za with an
 * unhelpful message.
 *
 * **macOS is `null`, and that is a decision rather than an omission.** BtbN publishes no macOS
 * asset at all (win64/winarm64/linux64/linuxarm64 only), and every mainstream macOS FFmpeg
 * distribution is GPL: evermeet.cx, osxexperts.net, Homebrew's formula and the popular npm/PyPI
 * wrappers all configure with `--enable-gpl --enable-libx264 --enable-libx265`. Two genuinely
 * LGPL macOS options do exist - conda-forge's `lgpl_*` ffmpeg build, which is current but
 * dynamically linked against a ~40-package dependency closure, and the `ae-ffmpeg` 1.1.2 wheel,
 * which is static but frozen on a 2023 FFmpeg snapshot because 1.2.0 dropped ffprobe. Neither is
 * a drop-in, and choosing between "ship a 40-package closure" and "ship three-year-old FFmpeg" is
 * a distribution call for the project to make, not a gap for this script to paper over. Until it
 * is made, macOS reports conversion as unavailable - the same posture iOS signing already takes on
 * hosts zsign does not serve.
 */
const ASSETS = {
    win32: {
        x64: {
            asset: `ffmpeg-${FFMPEG_VERSION}-win64-lgpl-8.1.zip`,
            sha256: '089e4169e93b2b3f3acbfced3c0704d24276a225641bdda04d796d28b07a2a38',
            dir: `ffmpeg-${FFMPEG_VERSION}-win64-lgpl-8.1`,
            suffix: '.exe',
        },
    },
    linux: {
        x64: {
            asset: `ffmpeg-${FFMPEG_VERSION}-linux64-lgpl-8.1.tar.xz`,
            sha256: '8c8b2897f2a8093ae2d985f7f1867d218451d4c567c1b2437f86a7c73a950b9f',
            dir: `ffmpeg-${FFMPEG_VERSION}-linux64-lgpl-8.1`,
            suffix: '',
        },
    },
    // See the note above. Recorded rather than omitted so the skip below can say why.
    darwin: {
        arm64: null,
        x64: null,
    },
};

/** The binaries we stage. ffplay is in the archive too and is deliberately left behind. */
const BINARIES = ['ffmpeg', 'ffprobe'];

function argValue(name) {
    const prefix = `--${name}=`;
    const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
    return hit === undefined ? null : hit.slice(prefix.length);
}

function sha256(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

async function download(url, expectedSha256) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`GET ${url} failed with HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const actual = sha256(buffer);
    if (actual !== expectedSha256) {
        // Loud on purpose: a mismatch means the bytes are not the ones this build was reviewed
        // against, and unpacking them anyway would ship an unaudited binary inside the installer.
        // On this upstream it most likely means the pinned tag was pruned and something else now
        // answers the URL - see "WHY THIS TAG" above.
        throw new Error(
            `checksum mismatch for ${url}\n  expected ${expectedSha256}\n  actual   ${actual}`,
        );
    }
    return buffer;
}

/**
 * Make sure the bundled 7za can actually be executed.
 *
 * The exec bit on `7zip-bin`'s binaries does not reliably survive being installed into
 * node_modules, and CI installs fresh on every run. Costs nothing on a tree that is already
 * correct, and is the difference between working and `spawnSync .../7za EACCES` on Linux - where
 * the only symptom is this script failing to unpack an archive it downloaded perfectly well.
 *
 * Guarded on the HOST platform, not the target being staged: 7za runs here and now.
 */
let ensuredExecutable = false;
function ensure7zaExecutable() {
    if (ensuredExecutable || process.platform === 'win32') return;
    ensuredExecutable = true;
    try {
        fs.chmodSync(path7za, 0o755);
    } catch {
        // Deliberately ignored - see above.
    }
}

function run7za(args) {
    try {
        execFileSync(path7za, args, { stdio: 'pipe' });
    } catch (error) {
        const detail = error.stdout ? error.stdout.toString() : String(error);
        throw new Error(`7za ${args[0]} failed: ${detail}`);
    }
}

/**
 * Unpack the named entries out of a .zip or .tar.xz into `outDir`.
 *
 * The tarball takes two passes through 7za rather than one through zlib, which is where this
 * diverges from prepare-codesign-tools.js: upstream ships `.tar.xz`, and Node has no xz. 7za does,
 * and it names the intermediate by stripping the `.xz`, so the payload is written under a known
 * name to make that predictable instead of guessed.
 *
 * Entry names are given with forward slashes on every platform - 7za accepts them, and the archive
 * itself stores them that way.
 */
function extractEntries(archive, assetName, entries, outDir) {
    ensure7zaExecutable();
    const cleanup = [];
    let archivePath;
    if (assetName.endsWith('.zip')) {
        archivePath = path.join(outDir, '.payload.zip');
        fs.writeFileSync(archivePath, archive);
        cleanup.push(archivePath);
    } else if (assetName.endsWith('.tar.xz')) {
        const compressed = path.join(outDir, '.payload.tar.xz');
        fs.writeFileSync(compressed, archive);
        cleanup.push(compressed);
        run7za(['x', '-bd', '-y', `-o${outDir}`, compressed]);
        archivePath = path.join(outDir, '.payload.tar');
        cleanup.push(archivePath);
    } else {
        throw new Error(`unsupported archive type: ${assetName}`);
    }
    try {
        run7za(['x', '-bd', '-y', `-o${outDir}`, archivePath, ...entries]);
    } finally {
        for (const file of cleanup) {
            fs.rmSync(file, { force: true });
        }
    }
    for (const entry of entries) {
        const extracted = path.join(outDir, ...entry.split('/'));
        if (!fs.existsSync(extracted)) {
            throw new Error(`"${entry}" is not present in ${assetName}`);
        }
    }
}

/**
 * Refuse a binary that is not the LGPL build we think it is.
 *
 * FFmpeg embeds its full configure line in every binary, which makes this checkable without
 * running anything - so it works when cross-staging Linux from Windows, and it works on a binary
 * that would not execute here at all.
 *
 * Four assertions, in two pairs:
 *
 *   - `--enable-gpl` / `--enable-nonfree` must be ABSENT. Present means the wrong variant was
 *     downloaded, or upstream changed what the `-lgpl` name means. Either way, staging it would
 *     silently relicense the installer.
 *   - `--enable-libvpx` / `--enable-libvorbis` must be PRESENT. Without them the staging would
 *     succeed and the first VP9 conversion would fail, a long way from here.
 *
 * Verified against this pin on 2026-08-06: neither GPL flag appears, both codec flags do, and the
 * configure line additionally carries `--disable-libx264 --disable-libx265 --disable-libxvid`.
 */
function assertLgplBuild(binaryPath) {
    const bytes = fs.readFileSync(binaryPath);
    const has = (needle) => bytes.includes(Buffer.from(needle, 'latin1'));
    for (const forbidden of ['--enable-gpl', '--enable-nonfree']) {
        if (has(forbidden)) {
            throw new Error(
                `${path.basename(binaryPath)} was built with ${forbidden}; only LGPL builds may be `
                + 'staged, because bundling a GPL binary relicenses the installer',
            );
        }
    }
    for (const required of ['--enable-libvpx', '--enable-libvorbis']) {
        if (!has(required)) {
            throw new Error(
                `${path.basename(binaryPath)} was built without ${required}, so it cannot produce `
                + 'the project\'s VP9 + Vorbis target',
            );
        }
    }
}

/** True when the staged tree is already exactly what this script would produce. */
function alreadyStaged(targetDir, spec, platform, arch) {
    const manifestPath = path.join(targetDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        return false;
    }
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
        return false;
    }
    if (
        manifest.tool !== 'ffmpeg'
        || manifest.version !== FFMPEG_VERSION
        || manifest.platform !== platform
        || manifest.arch !== arch
        || manifest.asset !== spec.asset
        || manifest.assetSha256 !== spec.sha256
    ) {
        return false;
    }
    if (!fs.existsSync(path.join(targetDir, 'LICENSE'))) {
        return false;
    }
    // Hash the bytes rather than trusting the manifest's word for them: a truncated or half-written
    // binary is the failure this guard exists for.
    for (const binary of BINARIES) {
        const staged = path.join(targetDir, `${binary}${spec.suffix}`);
        if (!fs.existsSync(staged)) {
            return false;
        }
        if (sha256(fs.readFileSync(staged)) !== manifest.binaries?.[binary]) {
            return false;
        }
    }
    return true;
}

(async () => {
    if (process.env.NLS_SKIP_FFMPEG === '1') {
        console.log('[ffmpeg] NLS_SKIP_FFMPEG=1, skipping; media conversion will report as unavailable');
        return;
    }

    const platform = argValue('platform') ?? process.platform;
    const arch = argValue('arch') ?? process.arch;
    const spec = ASSETS[platform]?.[arch] ?? null;
    if (spec === null) {
        // Not an error. A host with no LGPL build still produces a working Studio - one that
        // reports conversion as unavailable instead of shipping a binary it may not redistribute.
        console.warn(
            `[ffmpeg] no LGPL FFmpeg build is vendored for ${platform}-${arch}; skipping. `
            + 'The resulting Studio cannot convert media on this platform '
            + '(point NLS_FFMPEG_DIR at a directory holding ffmpeg and ffprobe to work around it).',
        );
        return;
    }

    const targetDir = path.join(rootDir, 'resources', 'ffmpeg', platform);
    if (alreadyStaged(targetDir, spec, platform, arch)) {
        console.log(`[ffmpeg] ${FFMPEG_VERSION} already staged for ${platform}-${arch}, nothing to do`);
        return;
    }

    const stagingDir = `${targetDir}.staging-${process.pid}`;
    try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        fs.mkdirSync(stagingDir, { recursive: true });

        console.log(`[ffmpeg] fetching ${spec.asset} (${BUILD_TAG})`);
        const archive = await download(`${RELEASE_BASE}${spec.asset}`, spec.sha256);

        const licenseEntry = `${spec.dir}/LICENSE.txt`;
        const binaryEntries = BINARIES.map((binary) => `${spec.dir}/bin/${binary}${spec.suffix}`);
        extractEntries(archive, spec.asset, [...binaryEntries, licenseEntry], stagingDir);

        const license = fs.readFileSync(path.join(stagingDir, spec.dir, 'LICENSE.txt'));
        if (sha256(license) !== LICENSE_SHA256) {
            throw new Error(
                'the archive\'s LICENSE.txt is not the LGPLv3 text this pin was reviewed against; '
                + 'upstream may have changed the build\'s licensing',
            );
        }
        fs.writeFileSync(path.join(stagingDir, 'LICENSE'), license);

        const binarySha256 = {};
        for (const binary of BINARIES) {
            const extracted = path.join(stagingDir, spec.dir, 'bin', `${binary}${spec.suffix}`);
            assertLgplBuild(extracted);
            const staged = path.join(stagingDir, `${binary}${spec.suffix}`);
            fs.renameSync(extracted, staged);
            // The archive's mode bits do not reliably survive extraction, and a non-executable
            // ffprobe fails much later with a confusing EACCES.
            if (spec.suffix === '') {
                fs.chmodSync(staged, 0o755);
            }
            binarySha256[binary] = sha256(fs.readFileSync(staged));
        }
        fs.rmSync(path.join(stagingDir, spec.dir), { recursive: true, force: true });

        fs.writeFileSync(
            path.join(stagingDir, 'manifest.json'),
            `${JSON.stringify(
                {
                    tool: 'ffmpeg',
                    version: FFMPEG_VERSION,
                    platform,
                    arch,
                    asset: spec.asset,
                    assetSha256: spec.sha256,
                    binaries: binarySha256,
                    license: 'LICENSE',
                    licenseId: 'LGPL-3.0-or-later',
                    source: `https://github.com/BtbN/FFmpeg-Builds/releases/tag/${BUILD_TAG}`,
                },
                null,
                4,
            )}\n`,
        );

        // Replace wholesale rather than merge: binaries left behind by an older pin would
        // otherwise ship inside the installer alongside the new ones.
        fs.rmSync(targetDir, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(targetDir), { recursive: true });
        fs.renameSync(stagingDir, targetDir);

        console.log(
            `[ffmpeg] Staged ffmpeg + ffprobe ${FFMPEG_VERSION} (${platform}-${arch}) to `
            + `${path.relative(rootDir, targetDir)}`,
        );
    } catch (error) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        console.error(`[ffmpeg] Failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
})();
