#!/usr/bin/env node

/*
 * Stage the vendored code-signing tools into resources/, from where
 * electron-builder's per-platform extraResources copies them into the packaged
 * Studio. Today that is exactly one tool: zsign, which re-signs the iOS IPA.
 *
 * Same discipline as prepare-mobile-shell.js — the payload is fetched while
 * *Studio* is being built, never on the author's machine. A packaged Studio
 * signs an IPA with zero downloads and zero toolchain, which is the whole point:
 * the mobile build pipeline is offline by construction and iOS signing must not
 * be the one step that breaks that.
 *
 * The one difference from the shell templates is where the bytes come from: a
 * pinned GitHub release rather than an npm package. So this script carries the
 * trust anchor itself — the sha256 of every asset is written down here and
 * verified before anything is unpacked. Deliberately not read from the release's
 * own SHA256SUMS.txt: a checksum fetched from the same place as the payload
 * proves nothing, since whoever could re-point the asset could re-point the
 * checksum with it.
 *
 * Layout produced (one platform/arch pair per run, the host's unless --platform
 * and --arch say otherwise):
 *
 *   resources/codesign/<platform>/zsign[.exe]   the binary
 *   resources/codesign/<platform>/LICENSE       upstream MIT notice; we
 *                                               redistribute the binary, so the
 *                                               notice ships next to it
 *   resources/codesign/<platform>/manifest.json what was staged, so a second
 *                                               run is a no-op
 *
 * Usage:
 *   node project/build/prepare-codesign-tools.js
 *   node project/build/prepare-codesign-tools.js --platform=darwin --arch=arm64  # cross-stage
 *
 * Env:
 *   NLS_SKIP_CODESIGN_TOOLS=1  skip entirely (offline development builds). The
 *                              resulting Studio reports iOS signing as
 *                              unavailable rather than failing to build.
 */

const { execFileSync } = require("child_process");
const { createHash } = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { path7za } = require("7zip-bin");
const { rootDir } = require("./utils");

/** Upstream release we vendor. Mirrored by ZSIGN_VERSION in src/main/buildWorker/mobile/zsignTool.ts. */
const ZSIGN_VERSION = "1.1.1";
const ZSIGN_TAG = `v${ZSIGN_VERSION}`;
const RELEASE_BASE = `https://github.com/zhlynn/zsign/releases/download/${ZSIGN_TAG}/`;
// The LICENSE is not inside any release asset, so it comes from the tag itself.
const LICENSE_URL = `https://raw.githubusercontent.com/zhlynn/zsign/${ZSIGN_TAG}/LICENSE`;
const LICENSE_SHA256 = "57a50ade7eafe84091e7f97169e2c555980513e5d425ba8b21c76ce7458f602c";

/**
 * Which asset serves which host, keyed by process.platform.
 *
 *   - windows-x64 is a 4.5 MB single file with OpenSSL and the CRT linked in;
 *     `objdump -p` shows only stock system DLLs, so bundling it costs nothing
 *     beyond its size and adds no VC++ runtime requirement.
 *   - Linux takes the *musl static* build on purpose. zsign-linux-x86_64.tar.gz
 *     is a quarter of the size because it dynamically links the build host's
 *     libssl — which is precisely the dependency a vendored tool must not have.
 *   - macOS has an arm64 asset and no x64 one, and that is now moot as well as
 *     true: Studio is not shipped for Intel Macs, so darwin-x64 is not a host
 *     anything is staged for. The missing zsign asset was one of the three
 *     reasons for that decision — see the `null` entry below and the note in
 *     zsignTool.ts.
 *
 * The arch keyed on here comes from the caller rather than from process.arch.
 * That is about the *target installer's* architecture, which is not necessarily
 * the runner's; no shipped target cross-builds today, but the parameter is what
 * keeps that a fact about the matrix rather than an assumption in this file.
 *
 * `entry` is the name inside the archive, `binary` the name we stage it under —
 * the Linux asset unpacks as `zsign-musl`, and callers should not have to care.
 */
const ASSETS = {
  win32: {
    x64: {
      asset: "zsign-windows-x64.zip",
      sha256: "1b0eed7a64a3ee28bedd941072b546520c20c5e4a6983b0743e8a7c1b42b1bff",
      entry: "zsign.exe",
      binary: "zsign.exe"
    }
  },
  linux: {
    x64: {
      asset: "zsign-linux-musl-static.tar.gz",
      sha256: "9880b0e1290dea211481fd031bcca8d0d7f3f09ba1c6a89743b3422df1ac14b9",
      entry: "zsign-musl",
      binary: "zsign"
    }
  },
  darwin: {
    arm64: {
      asset: "zsign-macos-arm64.tar.gz",
      sha256: "f50da4b23c807e4e43b2ef5f16cc90bb1aec2ab790d07a2380e16440d767f029",
      entry: "zsign",
      binary: "zsign"
    },
    // No macOS x64 asset exists upstream at v1.1.1, and Studio no longer
    // ships an Intel-Mac host to want one. Recorded rather than omitted so
    // the skip below can say why.
    x64: null
  }
};

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
    // Loud on purpose: a mismatch means the bytes are not the ones this
    // build was reviewed against, and unpacking them anyway would ship an
    // unaudited binary inside the installer.
    throw new Error(
      `checksum mismatch for ${url}\n  expected ${expectedSha256}\n  actual   ${actual}`
    );
  }
  return buffer;
}

/**
 * Make sure the bundled 7za can actually be executed.
 *
 * Same failure as the zsign chmod below, one layer up: the exec bit on
 * `7zip-bin`'s binaries does not reliably survive being installed into
 * node_modules, and CI installs fresh on every run. It costs nothing on a tree
 * that is already correct, and it is the difference between working and
 * `spawnSync .../7za EACCES` on Linux - where the only symptom is this script
 * failing to unpack an archive it downloaded perfectly well.
 *
 * Guarded on the HOST platform, not the target being staged: 7za runs here and
 * now. Windows has no exec bit, and a chmod failure is left to surface as the
 * spawn's own error rather than being reported as a permissions problem when it
 * might be something else.
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

/**
 * Unpack one named entry out of a .zip or .tar.gz into `outDir`.
 *
 * 7za (already a dependency, and already used this way by winCodeSignCache)
 * handles the zip directly; for tarballs the gzip layer comes off with zlib so
 * we never have to guess what 7za would name its intermediate file.
 */
function extractEntry(archive, assetName, entry, outDir) {
  ensure7zaExecutable();
  let archivePath;
  if (assetName.endsWith(".zip")) {
    archivePath = path.join(outDir, ".payload.zip");
    fs.writeFileSync(archivePath, archive);
  } else if (assetName.endsWith(".tar.gz")) {
    archivePath = path.join(outDir, ".payload.tar");
    fs.writeFileSync(archivePath, zlib.gunzipSync(archive));
  } else {
    throw new Error(`unsupported archive type: ${assetName}`);
  }
  try {
    execFileSync(path7za, ["x", "-bd", "-y", `-o${outDir}`, archivePath, entry], { stdio: "pipe" });
  } catch (error) {
    const detail = error.stdout ? error.stdout.toString() : String(error);
    throw new Error(`could not extract "${entry}" from ${assetName}: ${detail}`);
  } finally {
    fs.rmSync(archivePath, { force: true });
  }
  const extracted = path.join(outDir, entry);
  if (!fs.existsSync(extracted)) {
    throw new Error(`"${entry}" is not present in ${assetName}`);
  }
  return extracted;
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
    // Unreadable is treated as absent everywhere: staging replaces the tree
    // wholesale, so there is nothing to be gained by distinguishing
    // "corrupt" from "missing".
    return null;
  }
}

/** True when the staged tree is already exactly what this script would produce. */
function alreadyStaged(targetDir, spec, platform, arch) {
  const manifest = stagedManifest(targetDir);
  if (manifest === null) {
    return false;
  }
  if (
    manifest.tool !== "zsign" ||
    manifest.version !== ZSIGN_VERSION ||
    manifest.platform !== platform ||
    manifest.arch !== arch ||
    manifest.asset !== spec.asset ||
    manifest.assetSha256 !== spec.sha256 ||
    manifest.binary !== spec.binary
  ) {
    return false;
  }
  const binaryPath = path.join(targetDir, spec.binary);
  if (!fs.existsSync(binaryPath) || !fs.existsSync(path.join(targetDir, "LICENSE"))) {
    return false;
  }
  // Hash the bytes rather than trusting the manifest's word for them: a
  // truncated or half-written binary is the failure this guard exists for.
  return sha256(fs.readFileSync(binaryPath)) === manifest.binarySha256;
}

(async () => {
  if (process.env.NLS_SKIP_CODESIGN_TOOLS === "1") {
    console.log(
      "[codesign-tools] NLS_SKIP_CODESIGN_TOOLS=1, skipping; iOS signing will report as unavailable"
    );
    return;
  }

  const platform = argValue("platform") ?? process.platform;
  // --arch, not process.arch: the runner's architecture is not necessarily the
  // installer's. pack-electron.js reads the target off electron-builder's own
  // --x64/--arm64 and forwards it here, so what gets staged follows what is
  // being packaged instead of what happens to be packaging it.
  const arch = argValue("arch") ?? process.arch;

  const targetDir = path.join(rootDir, "resources", "codesign", platform);

  // electron-builder copies whatever is sitting in resources/codesign/<platform>
  // into the installer it is building and has no idea what architecture those
  // bytes are for, so a tree staged for a different arch is discarded here.
  // `alreadyStaged` cannot cover the case: an arch with no asset returns at the
  // skip below, before any staging decision is made.
  //
  // No shipped target cross-builds any more — Studio packages one arch per
  // platform, macOS being Apple Silicon only — so today this fires on a checkout
  // still holding a tree from an older pin or an older Studio. It stays because
  // the failure it prevents (a Mach-O that cannot execute where the installer
  // lands) is silent, and it costs one manifest read.
  const stagedArch = stagedManifest(targetDir)?.arch ?? null;
  if (stagedArch !== null && stagedArch !== arch) {
    console.warn(
      `[codesign-tools] discarding the staged ${platform}-${stagedArch} zsign: this run ` +
        `targets ${platform}-${arch}, and shipping the other one would put a binary in the ` +
        "installer that cannot execute there"
    );
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  const spec = ASSETS[platform]?.[arch] ?? null;
  if (spec === null) {
    // Not an error. A target with no upstream asset still produces a working
    // Studio — one that reports iOS signing as unavailable instead of
    // shipping a binary that cannot run there.
    console.warn(
      `[codesign-tools] no zsign ${ZSIGN_TAG} asset for ${platform}-${arch}; skipping. ` +
        "The resulting Studio cannot sign iOS builds on this platform " +
        "(point NLS_ZSIGN_PATH at a self-built zsign to work around it)."
    );
    return;
  }

  if (alreadyStaged(targetDir, spec, platform, arch)) {
    console.log(
      `[codesign-tools] zsign ${ZSIGN_VERSION} already staged for ${platform}-${arch}, nothing to do`
    );
    return;
  }

  const stagingDir = `${targetDir}.staging-${process.pid}`;
  try {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir, { recursive: true });

    console.log(`[codesign-tools] fetching ${spec.asset} (zsign ${ZSIGN_TAG})`);
    const archive = await download(`${RELEASE_BASE}${spec.asset}`, spec.sha256);
    const license = await download(LICENSE_URL, LICENSE_SHA256);

    const extracted = extractEntry(archive, spec.asset, spec.entry, stagingDir);
    const binaryPath = path.join(stagingDir, spec.binary);
    if (extracted !== binaryPath) {
      fs.renameSync(extracted, binaryPath);
    }
    // The archive's mode bits do not reliably survive extraction, and a
    // non-executable zsign fails much later with a confusing EACCES.
    if (platform !== "win32") {
      fs.chmodSync(binaryPath, 0o755);
    }
    fs.writeFileSync(path.join(stagingDir, "LICENSE"), license);

    const binarySha256 = sha256(fs.readFileSync(binaryPath));
    fs.writeFileSync(
      path.join(stagingDir, "manifest.json"),
      `${JSON.stringify(
        {
          tool: "zsign",
          version: ZSIGN_VERSION,
          platform,
          arch,
          asset: spec.asset,
          assetSha256: spec.sha256,
          binary: spec.binary,
          binarySha256,
          license: "LICENSE",
          source: `https://github.com/zhlynn/zsign/releases/tag/${ZSIGN_TAG}`
        },
        null,
        4
      )}\n`
    );

    // Replace wholesale rather than merge: a binary left behind by an older
    // pin would otherwise ship inside the installer alongside the new one.
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.renameSync(stagingDir, targetDir);

    console.log(
      `[codesign-tools] Staged zsign ${ZSIGN_VERSION} (${platform}-${arch}) to ` +
        `${path.relative(rootDir, path.join(targetDir, spec.binary))}`
    );
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    console.error(
      `[codesign-tools] Failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
})();
