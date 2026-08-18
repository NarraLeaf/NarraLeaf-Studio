#!/usr/bin/env node

/*
 * Stage the vendored FFmpeg tools into resources/, from where electron-builder's per-platform
 * extraResources copies them into the packaged Studio. Two binaries: ffprobe, which reads what is
 * inside a media file, and ffmpeg, which converts it.
 *
 * Same discipline as prepare-codesign-tools.js, and the same reasoning: the payload is obtained
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
 *   resources/ffmpeg/<platform>/LICENSE          the notice for *this* build: the LGPLv3 text from
 *                                                inside the archive on Windows and Linux, the
 *                                                LGPLv2.1 text from the FFmpeg source tree on
 *                                                macOS. We redistribute the binaries, so the
 *                                                notice ships next to them - and the two builds
 *                                                are not under the same version of the licence,
 *                                                see WHERE THE BYTES COME FROM below
 *   resources/ffmpeg/<platform>/manifest.json    what was staged, so a second run is a no-op
 *
 * Usage:
 *   node project/build/prepare-ffmpeg.js
 *   node project/build/prepare-ffmpeg.js --platform=linux   # cross-stage
 *
 * Env:
 *   NLS_SKIP_FFMPEG=1     skip entirely (offline development builds). The resulting Studio reports
 *                         media conversion as unavailable rather than failing to build.
 *   NLS_REQUIRE_FFMPEG=1  turn every skip below into a failure. Set on the packaging workflows,
 *                         and see "SKIPPING IS RIGHT LOCALLY AND WRONG WHEN PACKAGING" below.
 *
 * ============================================================================================
 * SKIPPING IS RIGHT LOCALLY AND WRONG WHEN PACKAGING
 * ============================================================================================
 *
 * Every way this script can fail to produce a binary is a *skip*: a developer on a machine with no
 * toolchain, no network or no vendored build for their host still gets a Studio, one that reports
 * media conversion as unavailable. That is deliberate and stays.
 *
 * It is the wrong posture for a run that produces an installer. There, "unavailable" is not a
 * degraded development build, it is what every author who downloads it gets - and the only trace
 * is a warning line in the middle of a packaging log nobody reads when the job is green. That is
 * the same failure mode REQUIRE_ANDROID_SDK_ORACLE and REQUIRE_ZSIGN_ORACLE exist for in
 * .github/workflows/ci.yml: a silent skip is indistinguishable from a pass.
 *
 * So `NLS_REQUIRE_FFMPEG=1` makes each of them exit non-zero instead, and the packaging jobs set
 * it. Setting it together with NLS_SKIP_FFMPEG is a contradiction rather than a precedence
 * question, and is refused outright.
 *
 * ============================================================================================
 * WHERE THE BYTES COME FROM - TWO ROUTES, TWO LICENCES
 * ============================================================================================
 *
 * Windows and Linux take a prebuilt binary from BtbN/FFmpeg-Builds. macOS has no equivalent (see
 * the ASSETS table), so it is **compiled from pinned source** by build-ffmpeg-macos.sh, on the
 * machine doing the packaging, and only when that machine is a Mac.
 *
 * The two routes do not produce the same licence, and that difference is recorded rather than
 * smoothed over:
 *
 *   win32 / linux   BtbN configures with `--enable-version3`  ->  **LGPL-3.0-or-later**
 *   darwin          our configure line does not               ->  **LGPL-2.1-or-later**
 *
 * `manifest.json` carries `licenseId` and `provenance` for exactly this reason: whatever renders
 * Studio's third-party notices has to name the right licence version and the right source for each
 * platform's build, and it cannot infer either from the file names. The claim is not taken on
 * trust either - `assertLgplBuild` reads the configure string out of the staged binary and refuses
 * a macOS build that carries `--enable-version3`, because that binary would be v3 while the
 * LGPLv2.1 text shipped beside it said otherwise.
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
 * `--enable-version3` is set upstream, so the effective licence of the *prebuilt* binaries is
 * **LGPL v3**, and the archive's LICENSE.txt is the LGPLv3 text. The macOS build we compile
 * ourselves does not set it and is **LGPL v2.1**; it ships the LGPLv2.1 text instead. Two
 * obligations follow either way and are not discharged by this script: the notice must reach the
 * user (it ships beside the binaries, which covers it) and a written offer for the corresponding
 * FFmpeg source must be made. The second belongs in Studio's about / third-party notices, not
 * here - and it must offer the source that matches, which is why `provenance` is in the manifest.
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
 * The macOS binaries we build ourselves are an order of magnitude smaller - ffmpeg 23.1 MB +
 * ffprobe 22.9 MB, ~46 MiB staged - because they carry only what the configure line below asks
 * for, where BtbN's build carries every LGPL-compatible library it can find. Same shape, far less
 * of it, and the difference is the honest cost of a build made for one application.
 *
 * The shared variant is self-contained too - those are FFmpeg's own libraries, not the host's - so
 * the objection that ruled out shared builds for zsign does not apply here, and it is the lever to
 * pull if installer size becomes the problem. It costs a per-platform layout (`bin/` beside `lib/`
 * on Linux, DLLs beside the exes on Windows) that the resolver would have to learn.
 */

const { execFileSync } = require("child_process");
const { createHash } = require("crypto");
const fs = require("fs");
const path = require("path");
const { path7za } = require("7zip-bin");
const { rootDir } = require("./utils");

/**
 * Prebuilt upstream build we vendor on Windows and Linux. Mirrored by FFMPEG_VERSION in
 * src/main/app/application/managers/media/ffmpegTool.ts. macOS has its own version constant below;
 * it is compiled, not downloaded.
 */
const FFMPEG_VERSION = "n8.1.2-34-g9b6c8969e0";
const BUILD_TAG = "autobuild-2026-07-31-14-10";
const RELEASE_BASE = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${BUILD_TAG}/`;

/** The LGPLv3 text shipped inside both archives. Identical byte-for-byte across platforms. */
const LICENSE_SHA256 = "da7eabb7bafdf7d3ae5e9f223aa5bdc1eece45ac569dc21b3b037520b4464768";

/**
 * The macOS build is compiled here rather than downloaded, so its "version" is the FFmpeg release
 * it is built from - a different, earlier commit than the BtbN pin above. Kept apart on purpose:
 * writing the BtbN string into a manifest for bytes that never came from BtbN would make the
 * `alreadyStaged` check and the third-party notice both lie.
 *
 * The tarball name and sha256 are duplicated from build-ffmpeg-macos.sh, which verifies them
 * itself before unpacking anything. They are repeated here so `alreadyStaged` can key on them the
 * same way it keys on a downloaded asset - bump one and the next run rebuilds instead of
 * short-circuiting. The two must agree; the script is the one that enforces it against real bytes.
 */
const FFMPEG_SOURCE_VERSION = "8.1.2";
const FFMPEG_SOURCE_ASSET = `ffmpeg-${FFMPEG_SOURCE_VERSION}.tar.xz`;
const FFMPEG_SOURCE_SHA256 = "464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c";
const FFMPEG_SOURCE_URL = `https://ffmpeg.org/releases/${FFMPEG_SOURCE_ASSET}`;
/** Repo-relative, forward-slashed: it is written into the manifest and printed, never joined raw. */
const MACOS_BUILD_SCRIPT = "project/build/build-ffmpeg-macos.sh";

/**
 * Which asset serves which host, keyed by process.platform.
 *
 * `dir` is the directory name inside the archive - it embeds the version, so it moves with the pin
 * and is written here rather than derived, since a wrong guess would fail deep inside 7za with an
 * unhelpful message.
 *
 * **macOS is built, not downloaded** (`build: 'source'`), because there is nothing fit to
 * download. BtbN publishes no macOS asset at all (win64/winarm64/linux64/linuxarm64 only), and
 * every mainstream macOS FFmpeg distribution is GPL: evermeet.cx, osxexperts.net, Homebrew's
 * formula and the popular npm/PyPI wrappers all configure with `--enable-gpl --enable-libx264
 * --enable-libx265`. The two genuinely LGPL macOS options are both unfit for a different reason -
 * conda-forge's `lgpl_*` build is current but dynamically linked against a ~40-package dependency
 * closure, and the `ae-ffmpeg` 1.1.2 wheel is static but frozen on a 2023 FFmpeg snapshot because
 * 1.2.0 dropped ffprobe. Compiling from pinned source avoids choosing between "ship a 40-package
 * closure" and "ship three-year-old FFmpeg": build-ffmpeg-macos.sh produces one self-contained
 * static binary per tool from tarballs verified against sha256s written down in the script, and
 * refuses to hand anything back that does not pass a licence and functional gate.
 *
 * The cost is that only a Mac can stage macOS, and only for its own architecture.
 *
 * `darwin.x64` is `null`, and the reason is no longer "we have not compiled it yet": **Studio is
 * not shipped for Intel Macs**, so there is no host to stage it for. Version control
 * (@lore-vcs ships only sdk-arm64-apple-darwin) and iOS signing (zsign publishes no macOS x64
 * asset) are missing there too, two of the three not ours to fix, and letting an author meet those
 * gaps one at a time after their work is inside the tool is worse than one honest "not this
 * platform". Rosetta runs x64 on Apple Silicon and never the reverse, so an arm64 build is not a
 * fallback either. Kept as an explicit `null` rather than omitted so the skip below can say why.
 *
 * None of that touches the *game* build targets: a game packaged on Apple Silicon still ships for
 * Intel Macs (GAME_BUILD_ARCHS_BY_PLATFORM in src/shared/types/gameBuild.ts). Those bytes are
 * @narraleaf/encryption's prebuilt darwin-x64 nlcrypto.node plus Electron's own x64 runtime,
 * neither of which is staged here.
 *
 * On any non-macOS host, and on a Mac with no Command Line Tools, staging is skipped and conversion
 * reports as unavailable; the packaging run does not fail, exactly as it does not fail today when a
 * platform has nothing to stage.
 */
const ASSETS = {
  win32: {
    x64: {
      asset: `ffmpeg-${FFMPEG_VERSION}-win64-lgpl-8.1.zip`,
      sha256: "089e4169e93b2b3f3acbfced3c0704d24276a225641bdda04d796d28b07a2a38",
      dir: `ffmpeg-${FFMPEG_VERSION}-win64-lgpl-8.1`,
      suffix: ".exe"
    }
  },
  linux: {
    x64: {
      asset: `ffmpeg-${FFMPEG_VERSION}-linux64-lgpl-8.1.tar.xz`,
      sha256: "8c8b2897f2a8093ae2d985f7f1867d218451d4c567c1b2437f86a7c73a950b9f",
      dir: `ffmpeg-${FFMPEG_VERSION}-linux64-lgpl-8.1`,
      suffix: ""
    }
  },
  darwin: {
    arm64: {
      build: "source",
      // Not an archive we unpack - the build script fetches and verifies it. Recorded here
      // so `alreadyStaged` has something version-shaped to key on, the way it keys on a
      // downloaded asset.
      asset: FFMPEG_SOURCE_ASSET,
      sha256: FFMPEG_SOURCE_SHA256,
      suffix: ""
    },
    // Studio does not ship for Intel Macs - see the note above. Recorded rather than omitted
    // so the skip below can say why.
    x64: null
  }
};

/** The binaries we stage. ffplay is in the archive too and is deliberately left behind. */
const BINARIES = ["ffmpeg", "ffprobe"];

/**
 * What goes in the manifest about *where this build came from and under what terms*.
 *
 * Derived from the spec rather than written into each row, because the two routes differ in every
 * one of these fields at once and pairing them up by hand is how a manifest ends up claiming LGPL
 * v3 for a v2.1 binary. See "WHERE THE BYTES COME FROM" at the top.
 *
 * `provenance` is what a third-party-notices renderer keys on: `prebuilt` needs a written offer
 * pointing at BtbN's corresponding sources, `from-source` at the exact FFmpeg release tarball
 * named in `source`.
 */
function manifestFacts(spec) {
  if (spec.build === "source") {
    return {
      version: FFMPEG_SOURCE_VERSION,
      licenseId: "LGPL-2.1-or-later",
      provenance: "from-source",
      source: FFMPEG_SOURCE_URL,
      builtBy: MACOS_BUILD_SCRIPT
    };
  }
  return {
    version: FFMPEG_VERSION,
    licenseId: "LGPL-3.0-or-later",
    provenance: "prebuilt",
    source: `https://github.com/BtbN/FFmpeg-Builds/releases/tag/${BUILD_TAG}`
  };
}

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return hit === undefined ? null : hit.slice(prefix.length);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
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
      `checksum mismatch for ${url}\n  expected ${expectedSha256}\n  actual   ${actual}`
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
  if (ensuredExecutable || process.platform === "win32") return;
  ensuredExecutable = true;
  try {
    fs.chmodSync(path7za, 0o755);
  } catch {
    // Deliberately ignored - see above.
  }
}

function run7za(args) {
  try {
    execFileSync(path7za, args, { stdio: "pipe" });
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
  if (assetName.endsWith(".zip")) {
    archivePath = path.join(outDir, ".payload.zip");
    fs.writeFileSync(archivePath, archive);
    cleanup.push(archivePath);
  } else if (assetName.endsWith(".tar.xz")) {
    const compressed = path.join(outDir, ".payload.tar.xz");
    fs.writeFileSync(compressed, archive);
    cleanup.push(compressed);
    run7za(["x", "-bd", "-y", `-o${outDir}`, compressed]);
    archivePath = path.join(outDir, ".payload.tar");
    cleanup.push(archivePath);
  } else {
    throw new Error(`unsupported archive type: ${assetName}`);
  }
  try {
    run7za(["x", "-bd", "-y", `-o${outDir}`, archivePath, ...entries]);
  } finally {
    for (const file of cleanup) {
      fs.rmSync(file, { force: true });
    }
  }
  for (const entry of entries) {
    const extracted = path.join(outDir, ...entry.split("/"));
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
 *
 * `extraForbidden` carries the one flag whose meaning is per-route rather than absolute:
 * `--enable-version3`. It is *expected* in the BtbN builds, which are LGPL v3 and ship the LGPLv3
 * text, and *forbidden* in the macOS build, which is LGPL v2.1 and ships the LGPLv2.1 text. Same
 * byte scan, opposite verdict, so it cannot be baked into the list above. This is what keeps the
 * manifest's `licenseId` an observation rather than an assumption.
 */
function assertLgplBuild(binaryPath, extraForbidden = []) {
  const bytes = fs.readFileSync(binaryPath);
  const has = (needle) => bytes.includes(Buffer.from(needle, "latin1"));
  for (const forbidden of ["--enable-gpl", "--enable-nonfree", ...extraForbidden]) {
    if (has(forbidden)) {
      throw new Error(
        forbidden === "--enable-version3"
          ? `${path.basename(binaryPath)} was built with --enable-version3, so it is LGPL ` +
              "v3 - but the LGPLv2.1 text is what ships beside it and the manifest says " +
              "LGPL-2.1-or-later. Fix the configure line or fix both of those, not one"
          : `${path.basename(binaryPath)} was built with ${forbidden}; only LGPL builds ` +
              "may be staged, because bundling a GPL binary relicenses the installer"
      );
    }
  }
  for (const required of ["--enable-libvpx", "--enable-libvorbis"]) {
    if (!has(required)) {
      throw new Error(
        `${path.basename(binaryPath)} was built without ${required}, so it cannot produce ` +
          "the project's VP9 + Vorbis target"
      );
    }
  }
}

/** The manifest of an already-staged tree, or null if there is not a readable one. */
function stagedManifest(targetDir) {
  const manifestPath = path.join(targetDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    // Unreadable is treated as absent everywhere: staging replaces the tree wholesale, so there
    // is nothing to be gained by distinguishing "corrupt" from "missing".
    return null;
  }
}

/** True when the staged tree is already exactly what this script would produce. */
function alreadyStaged(targetDir, spec, platform, arch) {
  const manifest = stagedManifest(targetDir);
  if (manifest === null) {
    return false;
  }
  const facts = manifestFacts(spec);
  if (
    manifest.tool !== "ffmpeg" ||
    manifest.version !== facts.version ||
    manifest.platform !== platform ||
    manifest.arch !== arch ||
    manifest.asset !== spec.asset ||
    manifest.assetSha256 !== spec.sha256 ||
    // A tree staged before the licence split carries no provenance and must be restaged, or a
    // notices page reading the manifest would find nothing where the licence version lives.
    manifest.provenance !== facts.provenance ||
    manifest.licenseId !== facts.licenseId
  ) {
    return false;
  }
  if (!fs.existsSync(path.join(targetDir, "LICENSE"))) {
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

/**
 * Download route: leave `<stagingDir>/ffmpeg[.exe]`, `<stagingDir>/ffprobe[.exe]` and
 * `<stagingDir>/LICENSE` behind, and nothing else.
 */
async function stageFromDownload(spec, stagingDir) {
  console.log(`[ffmpeg] fetching ${spec.asset} (${BUILD_TAG})`);
  const archive = await download(`${RELEASE_BASE}${spec.asset}`, spec.sha256);

  const licenseEntry = `${spec.dir}/LICENSE.txt`;
  const binaryEntries = BINARIES.map((binary) => `${spec.dir}/bin/${binary}${spec.suffix}`);
  extractEntries(archive, spec.asset, [...binaryEntries, licenseEntry], stagingDir);

  const license = fs.readFileSync(path.join(stagingDir, spec.dir, "LICENSE.txt"));
  if (sha256(license) !== LICENSE_SHA256) {
    throw new Error(
      "the archive's LICENSE.txt is not the LGPLv3 text this pin was reviewed against; " +
        "upstream may have changed the build's licensing"
    );
  }
  fs.writeFileSync(path.join(stagingDir, "LICENSE"), license);

  for (const binary of BINARIES) {
    fs.renameSync(
      path.join(stagingDir, spec.dir, "bin", `${binary}${spec.suffix}`),
      path.join(stagingDir, `${binary}${spec.suffix}`)
    );
  }
  fs.rmSync(path.join(stagingDir, spec.dir), { recursive: true, force: true });
}

/**
 * Report a reason no binary was staged, and decide whether that ends the run.
 *
 * Every caller `return`s straight after this, so the only difference between the two modes is
 * whether there is anything left to return to. See "SKIPPING IS RIGHT LOCALLY AND WRONG WHEN
 * PACKAGING" at the top.
 *
 * The workaround sentence is appended in both modes on purpose: someone reading this line in a
 * failed CI log needs it at least as much as a developer reading it locally.
 */
function skipOrFail(reason) {
  const message =
    `${reason} (point NLS_FFMPEG_DIR at a directory holding ffmpeg and ffprobe to ` +
    "work around it).";
  if (process.env.NLS_REQUIRE_FFMPEG === "1") {
    console.error(
      `[ffmpeg] ${message}\n[ffmpeg] NLS_REQUIRE_FFMPEG=1, so this is a failure rather than a ` +
        "skip: the Studio this run would produce reports media conversion as unavailable, and " +
        "shipping that silently is what the variable is set to prevent."
    );
    process.exit(1);
  }
  console.warn(`[ffmpeg] ${message}`);
}

/** Exit code build-ffmpeg-macos.sh uses for "this machine cannot build at all". */
const NO_TOOLCHAIN_EXIT = 3;

/**
 * Source route: hand the staging directory to build-ffmpeg-macos.sh and leave the same three files
 * behind. Returns `null` on success, or a one-line reason the caller should skip on.
 *
 * A build failure is a *skip*, not an error, which is the same posture the whole script already
 * takes towards a platform it cannot serve: a Mac without Command Line Tools must still be able to
 * package Studio, it just gets one that reports conversion as unavailable. That is why this returns
 * a reason instead of throwing.
 *
 * Invoked through `bash` explicitly rather than relying on the executable bit, which does not
 * survive a checkout made on Windows.
 *
 * `stdio: 'inherit'` on purpose. The build takes minutes and the script's own log lines - and, when
 * something goes wrong, the tail of the failing step's log - are the only thing standing between
 * the operator and a silent multi-minute pause.
 */
function stageFromSource(stagingDir) {
  const script = path.join(rootDir, ...MACOS_BUILD_SCRIPT.split("/"));
  if (!fs.existsSync(script)) {
    throw new Error(`${MACOS_BUILD_SCRIPT} is missing; it is what produces the macOS binaries`);
  }

  console.log(
    `[ffmpeg] no prebuilt LGPL FFmpeg exists for macOS, so ${FFMPEG_SOURCE_VERSION} is compiled ` +
      "here from pinned source. This takes roughly 3-5 minutes on an M1 - it has not hung. " +
      "The build's own output follows."
  );
  try {
    execFileSync("bash", [script, `--out=${stagingDir}`], { stdio: "inherit" });
  } catch (error) {
    const status = typeof error?.status === "number" ? error.status : null;
    if (status === NO_TOOLCHAIN_EXIT) {
      return "this machine has no Xcode Command Line Tools (run: xcode-select --install)";
    }
    return `${MACOS_BUILD_SCRIPT} failed${status === null ? "" : ` with exit code ${status}`}`;
  }

  // The script exited 0, so it also passed its own licence and functional gates. The one thing
  // left to check is the notice, and this one does throw rather than skip: binaries with no
  // licence text beside them is the single outcome that must never be papered over, and it can
  // only happen if the script itself was edited wrongly.
  const copying = path.join(stagingDir, "COPYING.LGPLv2.1");
  if (!fs.existsSync(copying)) {
    throw new Error(
      `${MACOS_BUILD_SCRIPT} produced no COPYING.LGPLv2.1; the binaries may not be staged ` +
        "without the licence text that has to ship beside them"
    );
  }
  fs.renameSync(copying, path.join(stagingDir, "LICENSE"));
  return null;
}

(async () => {
  if (process.env.NLS_SKIP_FFMPEG === "1") {
    if (process.env.NLS_REQUIRE_FFMPEG === "1") {
      // Not a precedence question. One says "do not stage", the other says "a run that does
      // not stage is a failed run", and guessing which the operator meant would silently do
      // the opposite of one of them.
      console.error(
        "[ffmpeg] NLS_SKIP_FFMPEG=1 and NLS_REQUIRE_FFMPEG=1 are both set, which asks for " +
          "a build that both omits FFmpeg and refuses to omit it. Unset one."
      );
      process.exit(1);
    }
    console.log(
      "[ffmpeg] NLS_SKIP_FFMPEG=1, skipping; media conversion will report as unavailable"
    );
    return;
  }

  const platform = argValue("platform") ?? process.platform;
  const arch = argValue("arch") ?? process.arch;

  // electron-builder copies whatever is sitting in resources/ffmpeg/<platform> into the installer
  // it is building and has no idea what architecture those bytes are for, so a tree staged for a
  // different arch is discarded here rather than shipped. Nothing downstream notices otherwise.
  //
  // No shipped target cross-builds any more - Studio packages one arch per platform, macOS being
  // Apple Silicon only - so today this fires on a checkout still holding a tree from an older
  // pin or an older Studio. It stays because the failure it prevents (a Mach-O that cannot
  // execute where the installer lands) is silent, and it costs one manifest read.
  const staleDir = path.join(rootDir, "resources", "ffmpeg", platform);
  const stagedArch = stagedManifest(staleDir)?.arch ?? null;
  if (stagedArch !== null && stagedArch !== arch) {
    console.warn(
      `[ffmpeg] discarding the staged ${platform}-${stagedArch} build: this run targets ` +
        `${platform}-${arch}, and shipping the other one would put a binary in the installer ` +
        "that cannot execute there"
    );
    fs.rmSync(staleDir, { recursive: true, force: true });
  }

  const spec = ASSETS[platform]?.[arch] ?? null;
  if (spec === null) {
    // Not an error, unless this run is producing an installer. A host with no LGPL build still
    // produces a working Studio - one that reports conversion as unavailable instead of
    // shipping a binary it may not redistribute.
    skipOrFail(
      `no LGPL FFmpeg build is vendored for ${platform}-${arch}; skipping. The resulting ` +
        "Studio cannot convert media on this platform"
    );
    return;
  }

  const facts = manifestFacts(spec);

  // Compiling can only happen on the machine the compiler is for. Checked before any staging
  // directory is made so that cross-staging macOS from CI reads as a skip with a reason, not as a
  // build that starts and then dies inside a shell script.
  if (spec.build === "source" && (process.platform !== platform || process.arch !== arch)) {
    skipOrFail(
      `${platform}-${arch} is compiled from source and cannot be cross-staged from ` +
        `${process.platform}-${process.arch}; skipping. The resulting Studio cannot convert ` +
        `media on ${platform} - build it on a ${platform}-${arch} machine`
    );
    return;
  }

  const targetDir = path.join(rootDir, "resources", "ffmpeg", platform);
  if (alreadyStaged(targetDir, spec, platform, arch)) {
    console.log(`[ffmpeg] ${facts.version} already staged for ${platform}-${arch}, nothing to do`);
    return;
  }

  const stagingDir = `${targetDir}.staging-${process.pid}`;
  try {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir, { recursive: true });

    if (spec.build === "source") {
      const skipReason = stageFromSource(stagingDir);
      if (skipReason !== null) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        skipOrFail(
          `could not build FFmpeg for ${platform}-${arch}: ${skipReason}. Skipping - the ` +
            "resulting Studio reports media conversion as unavailable rather than failing " +
            "to build"
        );
        return;
      }
    } else {
      await stageFromDownload(spec, stagingDir);
    }

    // Both routes converge here: two binaries and a LICENSE, sitting in the staging directory.
    const binarySha256 = {};
    for (const binary of BINARIES) {
      const staged = path.join(stagingDir, `${binary}${spec.suffix}`);
      // See the note on assertLgplBuild for why version3 is forbidden on one route and
      // expected on the other.
      assertLgplBuild(staged, spec.build === "source" ? ["--enable-version3"] : []);
      // The archive's mode bits do not reliably survive extraction, and a non-executable
      // ffprobe fails much later with a confusing EACCES.
      if (spec.suffix === "") {
        fs.chmodSync(staged, 0o755);
      }
      binarySha256[binary] = sha256(fs.readFileSync(staged));
    }

    fs.writeFileSync(
      path.join(stagingDir, "manifest.json"),
      `${JSON.stringify(
        {
          tool: "ffmpeg",
          version: facts.version,
          platform,
          arch,
          asset: spec.asset,
          assetSha256: spec.sha256,
          binaries: binarySha256,
          license: "LICENSE",
          licenseId: facts.licenseId,
          provenance: facts.provenance,
          source: facts.source,
          ...(facts.builtBy === undefined ? {} : { builtBy: facts.builtBy })
        },
        null,
        4
      )}\n`
    );

    // Replace wholesale rather than merge: binaries left behind by an older pin would
    // otherwise ship inside the installer alongside the new ones.
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.renameSync(stagingDir, targetDir);

    console.log(
      `[ffmpeg] Staged ffmpeg + ffprobe ${facts.version} (${platform}-${arch}, ` +
        `${facts.licenseId}) to ${path.relative(rootDir, targetDir)}`
    );
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    console.error(`[ffmpeg] Failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
})();
