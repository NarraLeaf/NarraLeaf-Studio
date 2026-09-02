import crypto from "crypto";
import type { LocaleCode } from "@shared/i18n";
import fs from "fs/promises";
import { createRequire } from "module";
import path from "path";
import { unpackAsarPath } from "../../../../../utils/asarPath";
import { assembleDevModeBundleFromProjectPath } from "../../devMode/pipeline/bundleAssembler";
import { compileAllBlueprintScriptsForProject } from "../../devMode/compiler/blueprint/compileProjectBlueprintScripts";
import {
    GAME_RUNTIME_PACK_SCHEMA_VERSION,
    type GameRuntimeAssetManifestEntry,
    type GameRuntimeLaunchEntry,
    type GameRuntimePackPluginEntry,
    type GameRuntimeNetworkConfig,
    type GameRuntimePackPuppetRuntimeEntry,
    type GameRuntimePackSidecarEntry,
    type GameRuntimePackV1,
    type GameRuntimeProjectIcon,
    type GameRuntimeProjectIconPlatform,
    type GameRuntimeProjectRevision,
    normalizeGameCrashPolicy,
    normalizeGameRuntimeViewportConfig,
} from "@shared/types/gameRuntime";
import type { AppTagBaseIdentity, AppTagPluginConfig, AppTagReachableScenes, ProjectAppTag } from "@shared/types/appTag";
import { APP_TAG_ID_RELEASE } from "@shared/types/appTag";
import { gameProgressKey } from "@shared/types/gameProgress";
import { resolveShippedPluginBuildConfig } from "@shared/utils/pluginBuildConfig";
import {
    collectReferencedAssetIds,
    collectReferencedIds,
    restrictCharacterUnits,
    restrictRecordToAssetIds,
} from "@shared/build/variantPayload";
import type { DevModeBundle } from "@shared/types/devMode";
import type { NormalizedPluginManifestV2 } from "@shared/types/plugins";
import { readProjectIconSet, resolveIconFile, resolveIconSource } from "@shared/types/projectIcons";
import type { ProjectConfigData } from "@shared/utils/nlproj";
import {
    NETWORK_POLICY_ALLOWLIST,
    normalizeNetworkAllowlistEntries,
    type NetworkPluginAllowlistEntry,
} from "@shared/types/networkAllowlist";
import {
    prepareArchiveReader,
    createAssetArchive,
    projectStamp,
    ASSET_ARCHIVE_FILENAME,
    ARCHIVE_READER_FILENAME,
    type AssetArchiveWriter,
} from "@narraleaf/bindings";
import { PER_TARGET_DIR_NAME, runningPlatformKeysFor } from "../../../../../buildWorker/perTargetPayload";
import {
    codecArchiveDir,
    codecPlacementsFor,
    hostCodecTarget,
    placeCodecBinary,
    writeSupportBinary,
    type CodecPlacement,
} from "../../../../../buildWorker/codecBinary";
import { ensureZigToolchain } from "../../../../../buildWorker/zigToolchain";
import { compileMainToBytecode, MAIN_BYTECODE_FILENAME, renderMainBytecodeBootstrap, reseedGuardMaskTable } from "../../../../../buildWorker/mainProcessBytecode";
import {
    GAME_RUNTIME_BUNDLE_PACK_ENTRY,
    gameRuntimeBundleAssetEntry,
    gameRuntimeBundleModelEntry,
    gameRuntimeBundleRuntimeEntry,
    isSealedShellFile,
    SEALED_SHELL_FILES,
} from "@shared/utils/gameRuntimeBundle";
import { readProjectAppTagDocumentFromDir } from "../../../utils/appTagsFile";
import { resolveAppTag, resolveAppTagEndingSurface } from "@shared/types/appTag";
import { readProjectConfigFromDir } from "../../../utils/projectConfigFile";
import { readPublishedPluginData } from "../../pluginRuntimeData";
// Relative rather than "@/": this module is unit-tested, and the test runner
// only aliases "@" to the renderer tree - a value import through it would not
// resolve. (Same reason as preflight.ts.)
import {
    ensurePluginBuildDependency,
    resolveBuildDependencyFile,
} from "../../../../../buildWorker/pluginBuildDependencies";
import type { DownloadRewriteRule } from "@shared/types/downloadSource";
import { splitAssetStorageId } from "@shared/utils/assetStorageId";
import { PACK_DELTA_VERSION } from "@shared/utils/packDelta";
import { countBuildStep } from "../../../../../buildWorker/stepProgress";
import { getMimeType } from "@shared/utils/fs";
import { detectModelBundleEntry, normalizeBundlePath, sortBundlePaths } from "@shared/utils/modelBundle";
import { PUPPET_RUNTIMES_PROJECT_DIR, PUPPET_RUNTIME_ENTRY_FILE } from "@shared/utils/puppetRuntimes";
import { characterAvatarAssetId } from "@shared/utils/characterAvatar";
import { collectWeatherSpecs, weatherClipAssetId, type PackedWeatherClip } from "@shared/weather/stage";
import { sanitizeProjectFileName } from "@shared/utils/nlproj";
import {
    deriveGameAppId,
    totalShippedAssetBytes,
    type GameBuildPlatform,
    type ShippedAssetReport,
    type ShippedAssetReportEntry,
} from "@shared/types/gameBuild";
import { normalizeSaveLocationConfiguration, userDataDirectoryName } from "@shared/utils/userDataLocation";
import { WEB_APPLE_TOUCH_FILENAME, WEB_FAVICON_FILENAME, writeWebShellFiles } from "./webShell";

const ASSET_TYPES = ["image", "audio", "video", "json", "blueprint", "font", "model", "other"] as const;
/** Asset types whose payload is a directory tree rather than one file. */
const BUNDLE_ASSET_TYPES: ReadonlySet<string> = new Set(["model"]);
// "bindings.js" and "vendor.js" are opaque support modules of @narraleaf/bindings
// that the packaged main.js requires (via computed requires the bundler cannot
// inline) from its own directory at startup; they are produced by the runtime
// build (build-runtime.js) and must ship next to main.js in every pack, so they
// are validated and copied like any other required runtime file. The requires
// run unconditionally at load, so a pack missing either crashes on launch
// regardless of whether asset protection is enabled. Keep this list in sync with
// RUNTIME_SUPPORT_SIDECARS in project/build/build-runtime.js.
const REQUIRED_RUNTIME_FILES = ["main.js", "bindings.js", "vendor.js", "preload.js", "renderer.js", "renderer.css", "index.html"] as const;
// The web shell replaces the Electron trio with the browser bridge bundle; the
// renderer pair is shared verbatim. Its index.html is generated per pack (see
// webShell.ts), not copied from the runtime dist.
const WEB_REQUIRED_RUNTIME_FILES = ["renderer.js", "renderer.css", "web.js"] as const;
const OPTIONAL_RUNTIME_FILES = ["main.js.map", "preload.js.map", "renderer.js.map", "renderer.css.map"] as const;
// Build marker written by project/build/build-runtime.js. It attests that the
// dist was produced by the runtime build script in production mode; it is
// validated before packing and never copied into the app dir.
const RUNTIME_BUILD_MANIFEST_FILENAME = "build-manifest.json";
/** Where sidecar payload lands inside the app dir; mirrored by buildAsarUnpackPatterns. */
const SIDECAR_DIR_NAME = "sidecars";
/**
 * Author-installed puppet backends: read from the project's own directory, written under this name in
 * the pack. The project-side layout is shared with the editor and the installer, so it is imported
 * rather than repeated — three copies of it was how the editor could list a backend the pack skipped.
 */
const PUPPET_RUNTIMES_PACK_DIR = "puppet";
/**
 * Marks an `include` entry as an artifact of a declared build dependency rather
 * than a file inside the plugin package. Kept in step with the manifest
 * validator's own prefix (pluginManifest.ts), which is where the spelling and
 * the `dep:<id>/<path>` shape are enforced.
 */
const SIDECAR_DEP_INCLUDE_PREFIX = "dep:";

export type GameRuntimePluginSource = {
    manifest: NormalizedPluginManifestV2;
    /** Manifest-declared runtime entry, normalized to forward slashes. */
    entry: string;
    /** Absolute path of the built runtime entry file inside the install dir. */
    entryPath: string;
    /** Absolute path of the plugin package root; sidecar `include` paths resolve against it. */
    installPath: string;
};

export type GameRuntimeArtifactCompileInput = {
    projectPath: string;
    entry: GameRuntimeLaunchEntry;
    runtimeDistDir: string;
    runtimeVersion: string;
    /**
     * Where the project stood in version control when this compile was asked for.
     *
     * Passed in rather than read here for the reason `locale` is: this module also runs off the main
     * process, and the version control backend is not reachable from there. Only the build and the
     * patch export pass one - they are the two runs that record a checkpoint first, so the revision
     * they name is the project this artifact was compiled from. A preview, a test run and a project
     * that is not under version control all pass nothing, and the pack then states nothing.
     */
    projectRevision?: GameRuntimeProjectRevision;
    /**
     * Directory the compiled app dir is written under (appDir = outputRoot/app).
     * Preview also keeps its persistent userData dir here; production staging
     * roots hold only the app dir.
     */
    outputRoot: string;
    /**
     * Studio-side control channel embedded in the pack so the workspace can
     * drive the running preview. Required in preview mode; must be absent for
     * production packs (a shipped game exposes no control server).
     */
    preview?: {
        controlPort: number;
        controlToken: string;
    };
    /** Runtime entries of enabled plugins to ship inside the pack. */
    runtimePlugins?: GameRuntimePluginSource[];
    /**
     * Baked weather clips available to this pack, keyed by the id the game computes for itself.
     *
     * Filled in by `compileGameRuntimeArtifactInWorker`, because producing one spawns an encoder and
     * that is the main process's job. Absent - and empty - is a project whose stories name no weather
     * seed, which is most of them.
     *
     * Offered rather than prescribed: this list is what the project *could* need, and the packer
     * carries only the ones the shipped stories still reach.
     */
    weatherClips?: readonly PackedWeatherClip[];
    /**
     * The build variant this artifact is. Absent is the release variant, which is what every preview
     * compile passes - nothing about a preview picks one.
     *
     * It reaches the bundle assembler and decides what the story documents contain, so it is not a
     * label on the output: two artifacts compiled from one project under two variants carry
     * different story bytes.
     */
    appTag?: { id: string; name: string };
    /**
     * What the author says each mechanism the build cannot read can start, already resolved for
     * {@link appTag}. Absent is "nothing declared", which is what every preview compile passes.
     *
     * Read only by `planSceneDrop`. Without it a project with a chapter select ships every story
     * whole under every variant, which is the whole of what makes a demo a demo.
     */
    declaredScenes?: AppTagReachableScenes;
    /**
     * Where {@link appTag} sits on each build-time asset axis, already resolved for it.
     *
     * Read only when a story names an asset set whose axis resolves at build time. Absent is "this
     * edition states no position", which every preview compile passes and which a project with no
     * build axes never needs - and which is refused rather than defaulted where one is needed, since
     * the position decides which art the package carries and which it withholds.
     */
    assetAxes?: Readonly<Record<string, string>>;
    /**
     * The language a failure this compile reports is written in.
     *
     * Carried on the input rather than read from Electron because this module also runs off the main
     * process (see compileGameRuntimeArtifactInWorker), where the stored `app.language` is out of
     * reach. Absent falls back to English, which is what a preview compile takes: previews report
     * nothing an author reads in their own language today.
     */
    locale?: LocaleCode;
    /**
     * Every `<platform>-<arch>` this app dir has to carry machine code for - the
     * keys plugin sidecar binaries are declared under.
     *
     * A production build passes all of its desktop targets and the payload is
     * staged per target, because one app dir is packaged several times and each
     * package must end up with its own; see perTargetPayload.ts. A preview passes
     * the host's own and it is staged at the app root, because a preview is run
     * here rather than packaged. Empty for web compiles, which ship no native
     * payload at all - a static site has no process to spawn and no addon to
     * load.
     */
    platformKeys?: readonly string[];
    /**
     * `build.zigMirror` as the author set it, for the toolchain a protected build
     * needs. Empty or absent is the official source. Carried on the input for the
     * same reason `hostCacheRoot` is: this runs off the main process, where the
     * setting is out of reach.
     */
    zigMirror?: string;
    /**
     * A C toolchain the caller has already got hold of, used instead of fetching
     * one.
     *
     * For a machine that keeps its own - an author who builds offline, or a test
     * that must not pull 76 MB to check the path it is testing. Absent is the
     * normal case: the toolchain is fetched once and cached.
     */
    titleCompiler?: string;
    /**
     * Every build target this one artifact serves.
     *
     * One compile is not one platform: the desktop compile serves whichever desktop targets the
     * request holds, and the web compile serves the browser export and both mobile repacks. It is
     * what a plugin's platform-scoped build config resolves against - where the served platforms
     * agree there is one answer to ship, and where they disagree the build says so rather than
     * picking one. Absent - Dev Mode, the preview - means no platform, and no such value travels.
     */
    platforms?: readonly GameBuildPlatform[];
    /**
     * These bytes are going into a package a player will get.
     *
     * Only the production build sets it. See `DevModeBundleLoadContext.packaging` for the line it
     * draws - folding a variant is for every host, planning what a package leaves out is for the one
     * host that produces a package.
     */
    packaging?: boolean;
    /**
     * This package is produced to be read back and then thrown away.
     *
     * Set by the patch export for the build it measures against: that package is compared entry by
     * entry and deleted, and no player ever receives it. Everything about what it carries is decided
     * exactly as a real package's would be - the same fold, the same trim, the same entry names, or
     * the comparison would be measuring something else.
     *
     * What it does change is the audit. The check that reads a produced package back and proves it
     * still reaches every asset it asks for exists to protect what ships; asking it of a package
     * nobody receives buys nothing and costs a compile of every story in every language. A defect it
     * would find there is a defect in a build of that variant, and a build of that variant is what
     * reports it.
     */
    forComparison?: boolean;
    /**
     * The DLC whose stories go into this artifact, on top of the game's own.
     *
     * Only the production build and the DLC export set it, and only one of them sets it to
     * anything: see `DevModeBundleLoadContext.includedDlc`.
     */
    includedDlc?: readonly string[];
    /**
     * Studio's own userData directory, used only as the root of the build
     * dependency cache that `dep:` sidecar includes resolve through. Passed in
     * rather than read from Electron because this module also runs off the main
     * process (see compileGameRuntimeArtifactInWorker), where app.getPath is
     * unavailable.
     */
    hostCacheRoot?: string;
    /** The author's download rewrites, for the same reason `hostCacheRoot` travels. */
    downloadRewrites?: readonly DownloadRewriteRule[];
    /**
     * Studio's own icon, shipped when the project configures none. Passed in
     * rather than resolved here because this module also runs off the main
     * process, where Electron's resource paths are not available.
     */
    defaultIcon?: {
        path: string;
        /** Pre-flattened variant for the outputs that forbid an alpha channel. */
        opaquePath?: string;
    };
    /**
     * Pack build mode. "preview" keeps developer affordances (DevTools);
     * "production" hardens the runtime. Defaults to "preview".
     */
    mode?: "preview" | "production";
    /**
     * Ship this artifact as one that accepts a remote-debugging switch at launch.
     *
     * The experimental `debuggable-build` condition, and nothing else, sets it. It is written into
     * both the pack and the loose app manifest because the runtime checks the two at different
     * moments - the manifest before Chromium starts, the pack once it is open.
     *
     * A sealed artifact still carries it, but it means less there: the runtime honours it only
     * while the app directory is being run by hand, never in the packaged game. The compile says so
     * rather than leaving the author to discover it. See `honoursDebuggableMarker`.
     */
    debuggable?: boolean;
    /**
     * Target shell. "electron" (default) emits the desktop runtime app dir;
     * "web" emits a static site: the shared renderer bundle plus the browser
     * bridge (web.js), a generated relative-URL index.html and the plugin-api
     * modules as real files. Web compiles are production-only and never
     * protected (a static site cannot carry the protection layer).
     */
    shell?: "electron" | "web";
    /**
     * Opaque pack key for asset protection. When set, packaged output is
     * protected via @narraleaf/bindings; when absent, output is written
     * verbatim (protection off).
     */
    encryptionKey?: string;
    /**
     * The app id this build ships under, as the build resolved it. Only the
     * production electron shell reads it, to name the per-user directory the
     * game keeps the player's files in; passing it keeps that name and the
     * packager's identity from being derived twice and disagreeing.
     */
    appId?: string;
    /**
     * The application name and identifier this build ships under, as the build
     * resolved them - a variant's overrides folded in. They name the installed
     * folder, the window and the web storage, so a demo installed beside the
     * release is a second application and not a second executable dropped into
     * the first one's folder. Absent for preview and Dev Mode, which have no
     * variant to fold and keep the project's own values.
     */
    productName?: string;
    identifier?: string;
    /**
     * The project's distribution key and the identity this build ships under.
     *
     * Passing it makes the build's protection material a function of the project
     * rather than of this run, which is the whole of what lets a patch produced
     * later be read by the build - and lets the build tell a patch from this
     * project apart from one anybody could have made. Absent for preview and Dev
     * Mode: neither is distributed, so neither is ever patched, and leaving them
     * on per-run material keeps the project's key out of throwaway output.
     *
     * `titleId` is the resolved app id, variant folded in, so two editions never
     * derive the same material. It is the caller's single resolution of identity,
     * not a second derivation - see how appId/productName/identifier travel.
     */
    distribution?: {
        key: string;
        titleId: string;
    };
    /**
     * Images this artifact ships re-encoded, keyed by asset id.
     *
     * The build re-encodes before it compiles, once, and hands every compile the
     * same table - so the desktop pack, the site the browser and both mobile
     * shells are built from, and any patch made later all carry the identical
     * bytes for an asset. Absent for the preview, Dev Mode and the tests: none of
     * them is what a player receives, and re-encoding artwork nobody will keep is
     * time an author is waiting through.
     */
    assetReplacements?: Readonly<Record<string, OptimizedAssetFile>>;
};

/**
 * One asset the build already re-encoded: the file to copy in place of the
 * project's, and what those bytes are.
 *
 * Written by two passes with nothing in common but this shape - one re-encodes
 * images in a hidden Chromium window, the other runs sound and video through
 * FFmpeg - and read here as a single table, so that a compile never has to know
 * which of them produced a given entry.
 *
 * Declared here rather than imported from the build manager because this module
 * runs in a utility process, and the value arrives across that boundary as
 * plain data.
 */
export type OptimizedAssetFile = {
    path: string;
    /**
     * Both absent when the replacement is the same kind of file as the source -
     * an image whose metadata was removed without re-encoding it. The manifest
     * already states what that image is, and restating it here would be a second
     * place for the two to disagree.
     */
    ext?: string;
    mimeType?: string;
};

export type GameRuntimeArtifactCompileResult = {
    outputRoot: string;
    appDir: string;
    /** Preview-only saves/persistence dir; production packs use the OS userData path. */
    userDataDir: string | null;
    packPath: string;
    pack: GameRuntimePackV1;
    copiedAssetCount: number;
    /**
     * Lines the caller has to put in the build console: decisions the compile made that change what
     * ships and that the author cannot see from the artifact.
     *
     * They travel on the result because the compile runs in a utility process, which has no channel
     * to the workspace window - `console.log` there reaches Studio's terminal, not the console the
     * author is reading.
     */
    notices: string[];
    /**
     * Whether this build's codec binaries were compiled for this title, rather
     * than the shipped ones written into.
     *
     * On the result rather than in `notices` because it is the difference between
     * an attack that has to be repeated for every game and one that has to be
     * mounted once, and an author who asked for protection should be told which
     * they got in the voice that difference deserves. Null when the question does
     * not arise: an unprotected build, or a preview.
     */
    codecCompiledForTitle: boolean | null;
    /**
     * A copy of the codec this machine can load, carrying what this build sealed
     * with. Null when the build sealed nothing.
     *
     * The shipped copies are staged per target and one of them may be for another
     * machine entirely, so "the binary in the app dir" is no longer a thing that
     * exists, let alone something this process can open. Anything that has to
     * read the artifact back - the shipped-content audit does - is told where.
     */
    codecHostImage: string | null;
    /**
     * Whether an asset set collapsed a build axis, i.e. this artifact deliberately leaves part of
     * the library out.
     *
     * Travels on the result so the worker can decide whether to audit. The audit is otherwise
     * skipped for the release edition on the grounds that a build carrying the library whole has
     * nothing to have got wrong - the same premise that decides trimming above, and a collapsed axis
     * is the counter-example to both. They have to move together: trimming without the audit is the
     * dangerous half, because it removes assets with nothing checking that the game still has the
     * ones it reaches for.
     */
    collapsedBuildAxis: boolean;
    /**
     * What this compile carried out of the asset library and what it left behind.
     *
     * Present exactly when the compile narrowed the library, which is every packaging compile and no
     * preview. **The worker decides whether to audit by whether this is here**, so the two can no
     * longer drift: trimming without the audit is the dangerous half, because it removes assets with
     * nothing checking that the shipped game still reaches every one it asks for.
     */
    assetReport?: ShippedAssetReport;
};

/**
 * Where packaged game payload goes. "loose" writes each item as its own plain
 * file under the app dir (used when protection is off). "sealed" streams every
 * item into a single consolidated store so the packed app dir exposes no
 * per-item files, names, sizes, or types. The compiler builds the same manifest
 * either way; only the destination and the manifest's recorded location differ.
 */
type PackTarget =
    | { kind: "loose" }
    | { kind: "sealed"; writer: AssetArchiveWriter };

type AssetMetadataRecord = {
    id?: unknown;
    type?: unknown;
    name?: unknown;
    hash?: unknown;
    ext?: unknown;
    source?: unknown;
    extras?: unknown;
};

export async function compileGameRuntimeArtifact(
    input: GameRuntimeArtifactCompileInput,
): Promise<GameRuntimeArtifactCompileResult> {
    const mode = input.mode ?? "preview";
    const shell = input.shell ?? "electron";
    if (mode === "preview" && !input.preview) {
        throw new Error("Preview artifact compile requires a preview control channel");
    }
    if (mode === "production" && input.preview) {
        throw new Error("Production artifact compile must not carry a preview control channel");
    }
    if (shell === "web" && mode !== "production") {
        throw new Error("Web artifact compile is production-only");
    }
    if (shell === "web" && input.encryptionKey) {
        throw new Error("Web artifact compile does not support asset protection");
    }
    // The first thing done with the output root is to delete `<root>/app` recursively. A relative
    // root resolves against whatever working directory the host process happens to have - in
    // development that is the Studio checkout itself - so a caller that handed over an unresolved
    // path would empty and rewrite a directory inside someone's source tree rather than inside a
    // staging area. Every caller derives this from a project path, which is absolute; a relative
    // one means that path was never resolved, and refusing is cheaper than the deletion.
    if (!path.isAbsolute(input.outputRoot)) {
        throw new Error(`Artifact compile needs an absolute output root, got "${input.outputRoot}"`);
    }
    const outputRoot = input.outputRoot;
    const appDir = path.join(outputRoot, "app");
    const userDataDir = mode === "preview" ? path.join(outputRoot, "userData") : null;
    const assetsDir = path.join(appDir, "assets");

    const engineVersion = await assertRuntimeDistReady(input.runtimeDistDir, shell);
    await fs.rm(appDir, { recursive: true, force: true });
    if (!input.encryptionKey) {
        // Loose items live under assets/; the sealed store needs no such dir.
        await fs.mkdir(assetsDir, { recursive: true });
    }
    if (userDataDir) {
        await fs.mkdir(userDataDir, { recursive: true });
    }
    /*
     * A packaged app dir is packaged once per target and each package must come
     * out holding its own machine code, so the payload is staged per target and
     * the packaging step maps one directory over the app root. A preview is run
     * from this directory rather than packaged, so its payload goes where the
     * game will look for it: here. See perTargetPayload.ts.
     */
    const nativePayloadKeys = shell === "web" ? [] : [...(input.platformKeys ?? [])];
    const perTargetPayload = Boolean(input.packaging);
    const payloadDirFor = (platformKey: string): string => (perTargetPayload
        ? path.join(appDir, PER_TARGET_DIR_NAME, platformKey)
        : appDir);
    /*
     * A protected build keeps its interface code in the store rather than beside
     * it, so those three are left out here and added to the store further down,
     * once there is a store to add them to. Everything else is copied either way:
     * Electron opens main.js and the preload itself, before anything of ours
     * could answer for them.
     */
    const sealsShell = Boolean(input.encryptionKey) && shell !== "web";
    // A shipped desktop game hardens its launch guard by shipping main.js as bytecode. Preview and
    // the experimental debuggable build stay readable source so an author can inspect and step
    // through the real main process; the web shell has no main.js at all.
    //
    // The bytecode is produced by this build worker, so it carries the host's CPU architecture, and
    // a V8 cache is not portable across architectures. One app directory serves every target in the
    // build and main.js sits at its shared root, so bytecode is only safe when every architecture
    // that root will be packaged for is the host's own. A universal macOS build (one root, two
    // architectures) and any cross-architecture target (e.g. an Intel-Mac game from an Apple-Silicon
    // Studio) therefore keep readable main.js - shipping bytecode there would refuse to boot on the
    // player's machine. `runningPlatformKeysFor` expands each target key, universal included, into
    // its `<platform>-<arch>` running keys; every one must be this host's.
    // Re-keying the guard's masked table happens on every shipped desktop build; shipping it as
    // bytecode additionally requires that every architecture the shared app root is packaged for is
    // the host's own (a V8 cache does not port across architectures, and one app root serves every
    // target - see the comment above and mainProcessBytecode.ts).
    const reseedGuard = mode === "production" && input.debuggable !== true && shell === "electron";
    const hostRunningKey = `${process.platform}-${process.arch}`;
    const servedRunningKeys = nativePayloadKeys.flatMap(runningPlatformKeysFor);
    const bytecodeMain = reseedGuard
        && servedRunningKeys.length > 0 && servedRunningKeys.every(key => key === hostRunningKey);
    await copyRuntimeFiles(input.runtimeDistDir, appDir, mode, shell, nativePayloadKeys, payloadDirFor, sealsShell, bytecodeMain, reseedGuard);
    // The support binary ships for protection, and also for a build that carries a
    // distribution key without it: a patch is read through that binary, so making
    // it conditional on protection alone would silently make patches a privilege
    // of protected builds. Two different questions, and they do not share a switch.
    const needsSupportBinary = Boolean(input.encryptionKey)
        || Boolean(input.distribution && shell !== "web");
    /*
     * Where each target's copy of the support binary goes, and which prebuilt
     * image each starts from.
     *
     * Both halves used to be answered for the host and the host only, which is
     * correct exactly when the machine packaging is the machine that will run the
     * result. A build producing Windows and macOS packages together wrote one
     * copy, of this machine's image, and every package but one shipped a binary
     * its loader refuses.
     */
    /* Collected here and reported once the artifact is written; the first of them
     * is raised by the codec below. */
    const notices: string[] = [];
/* A compile with no target named is a preview: it runs from this app dir on
     * this machine, so there is one copy, here, for this machine. */
    const placements = !needsSupportBinary
        ? []
        : nativePayloadKeys.length > 0
            ? codecPlacementsFor(
                nativePayloadKeys,
                platformKey => path.join(payloadDirFor(platformKey), ARCHIVE_READER_FILENAME),
            )
            : [{
                platformKey: hostCodecTarget(),
                destination: path.join(appDir, ARCHIVE_READER_FILENAME),
                slices: [hostCodecTarget()],
            }];
    /*
     * Every image the placements are made of, and where each is produced.
     *
     * Produced somewhere neutral rather than at the shipped path, because a
     * universal package's copy is two images in one file and neither of them is
     * that file. Everything below hands this map to the codec package, which
     * either writes this build's material into each or compiles each for this
     * title; the placements are assembled from the result afterwards.
     */
    const imageDir = path.join(outputRoot, "codec-images");
    const images: Record<string, string> = {};
    /*
     * One image for this machine as well, whether or not this machine is a target.
     *
     * Something has to be able to OPEN what was just sealed - the audit that
     * proves the shipped game still reaches every asset it asks for does exactly
     * that - and only an image built for this machine can be loaded here. When
     * this machine is a target it is the copy that ships; when it is not (a
     * Linux package built on a Mac) it exists only to be read here, out in the
     * staging directory rather than in the app dir, so it ships nowhere.
     */
    const slices = new Set(placements.flatMap(placement => placement.slices));
    if (placements.length > 0) {
        slices.add(hostCodecTarget());
    }
    for (const slice of slices) {
        images[slice] = path.join(imageDir, slice, ARCHIVE_READER_FILENAME);
        await fs.mkdir(path.dirname(images[slice]), { recursive: true });
    }

    /*
     * The toolchain that makes this build's binaries its own.
     *
     * With one, each image is built for this game alone, and a published copy of
     * the codec package opens nothing this build sealed - which is the whole
     * reason the codec is built here rather than shipped ready-made. Without one,
     * a prebuilt image is used instead, which is where this stood before and is
     * still a working protected build; it is just one an attacker has to defeat
     * once for every game rather than once per game. Whichever it is, it is said
     * out loud on the build log.
     */
    const titleCompile = await resolveTitleCompile({
        wanted: placements.length > 0 && Boolean(input.packaging),
        /* Named so the sentence tells the author which switch to reach for. */
        reason: input.encryptionKey ? "Asset protection" : "Shipping a build that can accept patches",
        ...(input.titleCompiler ? { explicitCompiler: input.titleCompiler } : {}),
        ...(input.hostCacheRoot ? { cacheRoot: input.hostCacheRoot } : {}),
        ...(input.zigMirror ? { mirror: input.zigMirror } : {}),
        ...(input.downloadRewrites ? { rewrites: input.downloadRewrites } : {}),
        workDir: imageDir,
    });
    if (!titleCompile) {
        /* Not a packaged build: a preview, whose binary is never handed to
         * anyone, so the prebuilt image with this pack's material written into it
         * is all it needs. */
        for (const [slice, destination] of Object.entries(images)) {
            await writeSupportBinary(slice, destination);
        }
    }

    const projectConfig = await readProjectConfig(input.projectPath);
    const endingSurfaceId = await readEndingSurfaceId(input.projectPath, input.appTag?.id);
    const progressKey = readProgressKey(projectConfig, input.projectPath);
    const pluginConfig = await readPluginConfigSource(input.projectPath, input.appTag?.id);
    const blueprintScripts = await compileAllBlueprintScriptsForProject(input.projectPath);
    if (!blueprintScripts.ok) {
        const detail = blueprintScripts.errors.join("\n") || "TypeScript blueprint compile failed";
        throw new Error(`Blueprint script compile failed:\n${detail}`);
    }
    const bundleId = crypto.randomUUID();
    // Set from inside the assembly below, and read after it to decide whether the library must be
    // narrowed. A `let` rather than a return value because the assembler answers with a bundle, and
    // this is a fact about how that bundle was produced rather than part of it.
    let collapsedBuildAxis = false;
    const assembled = await assembleDevModeBundleFromProjectPath({
        projectPath: input.projectPath,
        bundleId,
        revision: 1,
        blueprintCompiledScripts: blueprintScripts.scripts,
        blueprintScriptsCompileOk: blueprintScripts.ok,
        blueprintScriptsCompileErrors: blueprintScripts.errors,
        ...(input.appTag ? { appTag: input.appTag } : {}),
        ...(input.packaging ? { packaging: true } : {}),
        ...(input.includedDlc ? { includedDlc: input.includedDlc } : {}),
        // The declarations, not the count. A pack that merely carries a plugin can still drop a
        // scene; one that carries a plugin able to start a story cannot.
        runtimePlugins: (input.runtimePlugins ?? []).map(plugin => ({
            id: plugin.manifest.id,
            name: plugin.manifest.name ?? plugin.manifest.id,
            runtimeCapabilities: plugin.manifest.contributes.runtimeCapabilities ?? [],
        })),
        ...(input.declaredScenes ? { declaredScenes: input.declaredScenes } : {}),
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.assetAxes ? { assetAxes: input.assetAxes } : {}),
        onNotice: message => notices.push(message),
        onAssetSetCollapse: () => { collapsedBuildAxis = true; },
    });
    // Every package narrows the library to what it references, and only a package does: a preview
    // and a test address whatever the author points them at, so both carry it whole.
    //
    // This used to ask which edition was being built, on the grounds that only an edition that
    // removed story could be carrying content it could no longer reach. Two things made that false.
    // A collapsed build axis drops art from every edition including the release one. And a DLC's
    // stories are left out of the build they attach to, which takes their prose but not the art it
    // named - so the base package shipped the pictures of content nobody bought. A library sized for
    // content the package does not carry is public the moment someone opens the package, and an
    // asset nothing references is not reachable by any edition.
    const stripping = Boolean(input.packaging);
    const shipped = stripping
        ? await planShippedAssets(
            input.projectPath,
            assembled,
            input.runtimePlugins ?? [],
            message => notices.push(message),
            input.assetReplacements,
        )
        : null;
    const bundle = shippedBundle(shipped?.bundle ?? assembled, mode);
    if (shipped && shipped.report.excluded.length > 0) {
        notices.push(
            `${shipped.report.excluded.length} asset(s) are not referenced by this build and were left out`,
        );
    }

    // Bound before anything is written into it. A build with a distribution key
    // but no store never opens one, so this is the only place its binary is bound
    // - and an unbound binary reads no patch at all.
    if (input.distribution && needsSupportBinary && !input.encryptionKey) {
        await prepareArchiveReader(images, {
            projectMaterial: input.distribution.key,
            titleId: input.distribution.titleId,
        }, titleCompile ?? undefined);
        await placeCodecImages(placements, images);
    }

    // Everything below either writes loose files or streams into the store; on
    // any failure the store handle is released so a failed compile leaks nothing.
    const target: PackTarget = input.encryptionKey
        ? {
            kind: "sealed",
            /*
             * Every target's copy at once. They are bound to one store because
             * they carry the same material - the store a Windows package ships is
             * the store the macOS package built beside it opens - which is what
             * lets one compile serve a build that produces several packages.
             */
            writer: await createAssetArchive(
                path.join(appDir, ASSET_ARCHIVE_FILENAME),
                images,
                input.distribution
                    ? { projectMaterial: input.distribution.key, titleId: input.distribution.titleId }
                    : undefined,
                titleCompile ?? undefined,
            ),
        }
        : { kind: "loose" };
    /*
     * After the codec package has had its say and not before: whichever route was
     * taken, the images only carry this build's material once it has written them
     * or compiled them, and a copy taken earlier would be a copy of the wrong
     * thing. Once placed, the app dir holds what ships and the images do not
     * matter.
     */
    if (input.encryptionKey) {
        await placeCodecImages(placements, images);
    }

    /*
     * The interface code, into the store rather than beside it.
     *
     * Here rather than with the rest of the runtime files because there was no
     * store to put them in at that point. What a player receives for these three
     * is now bytes inside the same blob as the assets, which is the difference
     * between reading the game's code with a text editor and having to open the
     * store first.
     *
     * The ceiling is real and it is two files wide: Electron opens main.js and
     * the preload itself, before any of this exists, so they stay readable. What
     * is behind them is not the game's own code - it is the loader that asks the
     * store for it.
     */
    if (target.kind === "sealed" && sealsShell) {
        for (const fileName of SEALED_SHELL_FILES) {
            await target.writer.add(
                gameRuntimeBundleRuntimeEntry(fileName),
                await fs.readFile(path.join(input.runtimeDistDir, fileName)),
            );
        }
    }

    // The marker is written either way, but on a sealed artifact it reaches only half as far: the
    // runtime honours it while this app directory is run by hand and refuses it in the packaged
    // game, because the gate that decides in time reads the loose manifest and a shipped protected
    // build cannot have a text edit standing between a stranger and its content.
    const debuggable = input.debuggable === true;
    if (debuggable && input.encryptionKey) {
        notices.push(
            "asset protection is on: this artifact accepts a debugging switch only while its app "
            + "directory is run directly, never as the packaged game",
        );
    }

    try {
        const assetManifest = await copyProjectAssets({
            projectPath: input.projectPath,
            assetsDir,
            target,
            include: shipped?.include ?? null,
            ...(input.assetReplacements ? { assetReplacements: input.assetReplacements } : {}),
        });
        // Baked character avatars are derived project files, not library assets, so the walk
        // above never sees them. Without this pass a packaged game resolves every avatar to
        // nothing: the runtime addresses them by a synthetic id that only the manifest answers.
        await copyBakedCharacterAvatars({
            projectPath: input.projectPath,
            assetsDir,
            target,
            manifest: assetManifest,
            characterIds: shipped?.characterIds ?? null,
            ...(input.assetReplacements ? { assetReplacements: input.assetReplacements } : {}),
        });
        // Weather clips are derived the same way and are invisible to the sweep for a stronger
        // reason: the id that addresses one is COMPUTED by the running game rather than written in
        // any document, so no scan over the shipped bytes could ever find it.
        await copyWeatherClips({
            clips: input.weatherClips ?? [],
            bundle,
            assetsDir,
            target,
            manifest: assetManifest,
        });
        // The desktop icon set feeds the window/dock; a web site instead gets
        // a favicon (best-effort - only a configured PNG qualifies).
        const projectIcon = shell === "web"
            ? undefined
            : await copyProjectIcon({
                projectPath: input.projectPath,
                appDir,
                projectConfig,
                defaultIcon: input.defaultIcon,
            });
        const webIcons = shell === "web"
            ? await copyWebIcons({
                projectPath: input.projectPath,
                appDir,
                projectConfig,
                defaultIcon: input.defaultIcon,
            })
            : { hasFavicon: false, hasAppleTouchIcon: false };
        const packPlugins = await copyRuntimePlugins({
            appDir,
            projectPath: input.projectPath,
            runtimePlugins: input.runtimePlugins ?? [],
            target,
            pluginConfig,
            ...(input.platforms ? { platforms: input.platforms } : {}),
            onNotice: message => notices.push(message),
            /* Staged the same way as the codec and koffi, now that the pack can
             * name a file per machine. See mergeSidecarEntries. */
            platformKeys: nativePayloadKeys,
            destinationDirFor: payloadDirFor,
            ...(input.hostCacheRoot ? { hostCacheRoot: input.hostCacheRoot } : {}),
            ...(input.downloadRewrites ? { downloadRewrites: input.downloadRewrites } : {}),
        });
        const packPuppetRuntimes = await copyPuppetRuntimes({
            appDir,
            projectPath: input.projectPath,
            target,
        });

        // What this payload can say about DLC, as the assembler stated it - the one place that
        // decided. Absent there means "every DLC the project has", which no packaged build ever
        // is: every production compile names a selection, so this is empty on a base build and
        // holds one id on a DLC build.
        const installedDlc = [...(bundle.installedDlc ?? [])];

        const pack: GameRuntimePackV1 = {
            schemaVersion: GAME_RUNTIME_PACK_SCHEMA_VERSION,
            generatedAt: new Date().toISOString(),
            mode,
            ...(debuggable ? { debuggable: true } : {}),
            runtimeVersion: input.runtimeVersion,
            // What produced this pack, beside the Studio version that already stood here. Both are
            // written for every shell and every mode - a preview that could not say which engine it
            // runs would be the one place an author cannot check the answer.
            ...(engineVersion ? { engineVersion } : {}),
            // Only the callers that produce something a player can hold pass one; see the field.
            ...(input.projectRevision ? { projectRevision: input.projectRevision } : {}),
            project: {
                name: input.productName?.trim()
                    || projectConfig?.name?.trim()
                    || path.basename(input.projectPath)
                    || "NarraLeaf Game",
                identifier: input.identifier?.trim() || projectConfig?.identifier?.trim() || undefined,
                version: readString(projectConfig?.metadata?.version),
                metadata: normalizeRecord(projectConfig?.metadata),
                icon: projectIcon,
            },
            entry: input.entry,
            bundle,
            assets: shippedAssetManifest(assetManifest, mode, target.kind === "sealed"),
            plugins: packPlugins,
            ...(packPuppetRuntimes.length > 0 ? { puppetRuntimes: packPuppetRuntimes } : {}),
            // Carried on every shell, web included.
            //
            // `allowHttp` is enforced by two things only a desktop shell has - an injected CSP and a
            // `webRequest` hook - and a served page is on the network by construction, so the web
            // export does not read it. It is still written, because it is a fact about the project
            // rather than about one shell, and because the build gate already refuses to produce a
            // web build from a project that has network nodes while it is off.
            //
            // The allowlist half is a different question - which hosts this build was published to
            // reach - and that answer does not change with the shell, so every shell gets it and
            // every shell enforces it.
            network: {
                // Secure default: HTTP is only permitted when the project explicitly
                // opts in via app.network.allowHttp. Mirrors normalizeNetworkConfiguration.
                allowHttp: (projectConfig?.app as { network?: { allowHttp?: unknown } } | undefined)?.network?.allowHttp === true,
                ...resolvePackNetworkAllowlist(projectConfig, packPlugins),
            },
            // Unconditional, unlike `network` above: a crash is not a shell mechanism, and a
            // policy that applied to the desktop build but not the web one would be a setting that
            // means something different depending on where the author looks.
            crash: {
                policy: normalizeGameCrashPolicy(
                    (projectConfig?.app as { crash?: { policy?: unknown } } | undefined)?.crash?.policy,
                ),
            },
            // Resolved per variant: a demo ends where its cut point
            // is and lands on a page the full game never shows, so which surface ships is decided by
            // the same tag that decides the build's name. Omitted when blank, which is the state
            // every build was in before this field and the one the runtime treats as "show nothing".
            ...(endingSurfaceId ? { endingSurfaceId } : {}),
            // The DLC whose content is in this payload.
            //
            // Empty on the ordinary build, which is the point: a base build states nothing about
            // what else exists to buy. A DLC build holds the one it is for.
            //
            // The runtime adds to this the DLC it finds beside the game (`installedDlcIds`). The two
            // writers state the same thing about different halves: what shipped inside, and what was
            // installed outside.
            ...(installedDlc.length > 0 ? { installedDlc } : {}),
            // The public half only, and only when this build was given a key: a
            // build that carries no way to check a proof must say so by having no
            // field, rather than by carrying an empty one that reads as "checked".
            ...(input.distribution
                ? {
                    addOns: {
                        verificationKey: projectStamp(
                            input.distribution.key,
                            input.distribution.titleId,
                        ),
                        packDeltaVersion: PACK_DELTA_VERSION,
                        // Which variant this build is, so that it can refuse a DLC belonging to
                        // another one. Two variants that override no identity are sealed under
                        // the same material, so without this a demo would happily open the full
                        // game's extra chapter.
                        appTagId: input.appTag?.id ?? APP_TAG_ID_RELEASE,
                    },
                }
                : {}),
            // Unconditional and deliberately NOT resolved for `input.appTag`, unlike the two above:
            // this is the one field whose whole job is to be the same in every variant, so that a
            // demo and the full game - which have different app ids, different user-data
            // directories and different protection keys - can still hand a playthrough to each
            // other. See `@shared/types/gameProgress`. Omitted when the project names nothing the
            // key could be derived from, which the shells read as "this build carries no progress".
            ...(progressKey ? { progressKey } : {}),
            // Unconditional, unlike `network` above: the fit describes the game's art rather than a
            // shell mechanism, and the web export shares its pack with the mobile repack.
            viewport: normalizeGameRuntimeViewportConfig(
                (projectConfig?.app as { mobile?: unknown } | undefined)?.mobile,
            ),
            ...(input.preview ? { preview: input.preview } : {}),
        };

        const packJson = Buffer.from(JSON.stringify(pack), "utf-8");
        let packPath: string;
        if (target.kind === "sealed") {
            await target.writer.add(GAME_RUNTIME_BUNDLE_PACK_ENTRY, packJson);
            await target.writer.finalize();
            packPath = path.join(appDir, ASSET_ARCHIVE_FILENAME);
        } else {
            packPath = path.join(appDir, "pack.json");
            await fs.writeFile(packPath, packJson);
        }
        if (shell === "web") {
            await writeWebShellFiles({ appDir, pack, ...webIcons });
        } else {
            await fs.writeFile(
                path.join(appDir, "package.json"),
                JSON.stringify(
                    buildAppManifest(mode, input.runtimeVersion, pack, projectConfig, input.appId),
                    null,
                    2,
                ),
                "utf-8",
            );
        }

        return {
            outputRoot,
            appDir,
            userDataDir,
            packPath,
            pack,
            copiedAssetCount: Object.keys(assetManifest).length,
            notices,
            codecCompiledForTitle: placements.length > 0 && Boolean(input.packaging)
                ? titleCompile !== null
                : null,
            codecHostImage: images[hostCodecTarget()] ?? null,
            collapsedBuildAxis,
            ...(shipped ? { assetReport: shipped.report } : {}),
        };
    } catch (error) {
        if (target.kind === "sealed") {
            // Release the file handle; the partial store is discarded on the next
            // compile (appDir is wiped up front). finalize() is idempotent.
            await target.writer.finalize().catch(() => undefined);
        }
        throw error;
    }
}

/**
 * The loose app manifest Electron reads before any pack (possibly sealed) is
 * open. Production identity fields drive the shell's app name plus the
 * packager's product metadata. `narraleaf.mode` is the early mode marker the
 * runtime consults before app-ready; the pack's own `mode` stays authoritative.
 *
 * `narraleaf.userDataDir` travels the same way and for the same reason: the
 * runtime has to settle where the player's files live before Chromium starts,
 * which is long before it can open a sealed pack. It is resolved here rather
 * than in the runtime so the name is decided by the same code the build dialog
 * and the Project panel read - see userDataLocation.ts for why it is the app id
 * and not the display name.
 */
function buildAppManifest(
    mode: "preview" | "production",
    runtimeVersion: string,
    pack: GameRuntimePackV1,
    projectConfig: ProjectConfigData | null,
    appId: string | undefined,
): Record<string, unknown> {
    const base = {
        private: true,
        main: "main.js",
        // `debuggable` travels beside the mode because the runtime reads both before app-ready,
        // where the pack is not open yet. Taken from the pack so the two cannot disagree.
        narraleaf: { mode, ...(pack.debuggable ? { debuggable: true } : {}) },
    };
    if (mode === "preview") {
        // Preview keeps its userData beside the compiled app, so there is no
        // per-user directory to name.
        return {
            name: "narraleaf-preview-runtime",
            version: runtimeVersion,
            ...base,
        };
    }
    const identifier = pack.project.identifier ?? readString(projectConfig?.identifier);
    return {
        name: sanitizeProjectFileName(identifier ?? pack.project.name),
        productName: pack.project.name,
        version: pack.project.version ?? "0.0.0",
        description: readString(projectConfig?.metadata?.description),
        author: readString(projectConfig?.metadata?.author) ?? "NarraLeaf",
        ...base,
        narraleaf: {
            ...base.narraleaf,
            // The build's own app id when there is one, so a game writes under
            // the identity it ships with. The fallback derives from the same
            // project fields the build would have used; it only diverges from
            // the build's answer for a project with no identifier whose variant
            // renames it, and there the project's own name is the more stable
            // of the two anyway.
            userDataDir: userDataDirectoryName(appId ?? deriveGameAppId(identifier, pack.project.name)),
            // Which of the two places the player's files go, per platform group. It travels beside
            // the directory name because it is answered at the same moment and by the same reader:
            // the runtime settles both before Chromium starts. Normalized here so the runtime reads
            // a complete answer rather than a project's partial one.
            saveLocation: normalizeSaveLocationConfiguration(projectConfig?.app?.saveLocation),
        },
    };
}

/**
 * Refuse a runtime build that cannot be trusted, and hand back the engine version it recorded.
 *
 * The two belong together because they come off the same marker: the check is already reading the
 * manifest to establish that this dist was produced in production mode, and the engine version is
 * the other thing only that file knows. Absent for a dist built before the field existed, which
 * every reader of the pack has to treat as "this build does not state its engine".
 */
async function assertRuntimeDistReady(
    runtimeDistDir: string,
    shell: "electron" | "web",
): Promise<string | undefined> {
    const missing: string[] = [];
    for (const fileName of shell === "web" ? WEB_REQUIRED_RUNTIME_FILES : REQUIRED_RUNTIME_FILES) {
        try {
            await fs.access(path.join(runtimeDistDir, fileName));
        } catch {
            missing.push(fileName);
        }
    }
    if (missing.length > 0) {
        throw new Error(
            `Runtime build output is missing ${missing.join(", ")}. Run "yarn build:runtime" first.`,
        );
    }
    // Existence is not enough: a dist left behind by an older build script (or a
    // tampered one) could carry development React and ship it inside every pack.
    // build-runtime.js writes this marker on every successful build; anything
    // else is a stale or foreign dist and must be rebuilt, not packed.
    let manifest: { mode?: unknown; engineVersion?: unknown };
    try {
        manifest = await readJson<{ mode?: unknown; engineVersion?: unknown }>(
            path.join(runtimeDistDir, RUNTIME_BUILD_MANIFEST_FILENAME),
        );
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            throw new Error(
                `Runtime build output is missing ${RUNTIME_BUILD_MANIFEST_FILENAME}, so it cannot be ` +
                `verified as a production build. Run "yarn build:runtime" to rebuild it.`,
            );
        }
        throw error;
    }
    if (manifest.mode !== "production") {
        throw new Error(
            `Runtime build output at ${runtimeDistDir} is not a production build ` +
            `(${RUNTIME_BUILD_MANIFEST_FILENAME} reports mode ${JSON.stringify(manifest.mode)}). ` +
            `Run "yarn build:runtime" to rebuild it.`,
        );
    }
    // An empty string is as absent as a missing key: both mean the marker names no engine, and a
    // pack that carried "" would state that its engine is nothing rather than that it is unknown.
    return typeof manifest.engineVersion === "string" && manifest.engineVersion.trim()
        ? manifest.engineVersion.trim()
        : undefined;
}

/**
 * The C toolchain a shipped build's codec is compiled with.
 *
 * Only for a build that will be packaged. A preview runs from the app dir on
 * this machine and is thrown away; fetching a compiler to make its binary unique
 * to a title nobody will ship would be the cost of the feature with none of the
 * point.
 *
 * Not getting one FAILS THE BUILD, and that is a decision rather than an
 * oversight. The alternative was to write the material into the prebuilt image
 * instead: the game would work, the store would still be sealed, and what would
 * be lost is that a published copy of the codec package could open it - the one
 * thing the whole arrangement exists to prevent. An author who switched
 * protection on and got a build back has been told they are protected. Handing
 * them a weaker artifact with a line on a console is telling them something else
 * quietly, and the difference only shows up when somebody has already published
 * the game.
 *
 * So it stops, and the author decides: fix the machine, or turn off the thing
 * that needs it.
 */
async function resolveTitleCompile(options: {
    wanted: boolean;
    reason: string;
    explicitCompiler?: string;
    cacheRoot?: string;
    mirror?: string;
    rewrites?: readonly DownloadRewriteRule[];
    workDir: string;
}): Promise<{ compiler: string; workDir: string; archiveDir: string } | null> {
    if (!options.wanted) {
        return null;
    }
    const archiveDir = codecArchiveDir();
    const refuse = (detail: string): never => {
        throw new Error(
            `${options.reason} could not compile this title's content codec: ${detail}. `
            + "Install a C toolchain and build again, or turn it off.",
        );
    };
    if (options.explicitCompiler) {
        await fs.mkdir(options.workDir, { recursive: true });
        return { compiler: options.explicitCompiler, workDir: options.workDir, archiveDir };
    }
    if (!options.cacheRoot) {
        // The toolchain lives under it, so without one there is nowhere to put a
        // toolchain. A packaged build always carries it; a caller that asked for
        // packaging without it is a defect rather than a state.
        return refuse("this build was started without a cache directory to keep one in");
    }
    try {
        const compiler = await ensureZigToolchain({
            cacheRoot: options.cacheRoot,
            ...(options.mirror ? { mirror: options.mirror } : {}),
            ...(options.rewrites ? { rewrites: options.rewrites } : {}),
        });
        await fs.mkdir(options.workDir, { recursive: true });
        return { compiler, workDir: options.workDir, archiveDir };
    } catch (error) {
        return refuse(error instanceof Error ? error.message : String(error));
    }
}

/** Assemble each package's copy from the images produced for it. */
async function placeCodecImages(
    placements: readonly CodecPlacement[],
    images: Readonly<Record<string, string>>,
): Promise<void> {
    for (const placement of placements) {
        await placeCodecBinary(placement, images);
    }
}

async function copyRuntimeFiles(
    runtimeDistDir: string,
    appDir: string,
    mode: "preview" | "production",
    shell: "electron" | "web",
    /** Every target this app dir carries machine code for; empty for a web compile. */
    platformKeys: readonly string[],
    /** Where one target's machine code goes. See perTargetPayload.ts. */
    payloadDirFor: (platformKey: string) => string,
    /** Leave the interface code out; the caller puts it in the store instead. */
    sealsShell: boolean,
    /** Ship main.js as V8 bytecode behind a small loader rather than as readable source. */
    bytecodeMain: boolean,
    /** Re-key the guard's masked table in main.js per game (applies whether or not it is bytecode). */
    reseedGuard: boolean,
): Promise<void> {
    await fs.mkdir(appDir, { recursive: true });
    for (const fileName of shell === "web" ? WEB_REQUIRED_RUNTIME_FILES : REQUIRED_RUNTIME_FILES) {
        if (sealsShell && isSealedShellFile(fileName)) {
            continue;
        }
        // A shipped, non-debuggable build hardens its main.js. The guard's masked table is re-keyed
        // per game either way; then, when the target architecture is the host's, the readable source
        // becomes a main.jsc image and main.js becomes the small loader that runs it. Only main.js -
        // preload is opened by Electron in a sandboxed context that cannot load it this way, and the
        // renderer three go into the store (above). See mainProcessBytecode.ts.
        if (fileName === "main.js" && reseedGuard) {
            const source = reseedGuardMaskTable(await fs.readFile(path.join(runtimeDistDir, fileName), "utf8"));
            if (bytecodeMain) {
                await fs.writeFile(path.join(appDir, MAIN_BYTECODE_FILENAME), compileMainToBytecode(source));
                await fs.writeFile(path.join(appDir, fileName), renderMainBytecodeBootstrap(), "utf8");
            } else {
                await fs.writeFile(path.join(appDir, fileName), source, "utf8");
            }
            continue;
        }
        await fs.copyFile(path.join(runtimeDistDir, fileName), path.join(appDir, fileName));
    }
    for (const fileName of OPTIONAL_RUNTIME_FILES) {
        // Sourcemaps are a preview-session debugging aid; shipped games leave
        // them out to keep installers smaller and bundle internals unmapped.
        // (Web compiles are production-only, so this loop is a no-op there.)
        if (mode === "production" && fileName.endsWith(".map")) {
            continue;
        }
        await copyOptionalFile(path.join(runtimeDistDir, fileName), path.join(appDir, fileName));
    }
    if (shell === "web") {
        return;
    }
    /*
     * koffi's addon is machine code like the codec's, so it is staged the same
     * way: one copy per target, and the packaging step brings the right one to
     * the app root. A compile that names no target is a preview, which runs here.
     */
    if (platformKeys.length === 0) {
        await copyKoffiPackage(appDir, undefined);
        return;
    }
    for (const platformKey of platformKeys) {
        await copyKoffiPackage(payloadDirFor(platformKey), platformKey);
    }
}

/**
 * koffi, for the Move Mouse family.
 *
 * The packaged game's main process needs an FFI to position the system cursor, and koffi is the one
 * this application already depends on and already signs. It cannot be bundled - it resolves its own
 * `.node` by path at run time - so it ships as a directory beside the game's `main.js`, the way
 * `bindings.js`/`vendor.js` ship for the addon.
 *
 * The directory is `koffi/`, deliberately not `node_modules/koffi/`. electron-builder derives the
 * app's `node_modules` from the staged `package.json`'s dependencies and ships nothing else under
 * that name - a literal `node_modules` directory in the app source is dropped from the asar and
 * from the unpacked tree both, with one line in the packager log and no error. `systemCursor.ts`
 * knows to look here when the bare specifier does not resolve.
 *
 * Only the prebuild for the target is copied. The package carries eighteen of them and weighs 24 MB;
 * a game needs exactly one, and shipping the rest would put an ARM Linux binary inside every Windows
 * installer. A target with no prebuild copies nothing and the game degrades to "this host cannot
 * move the cursor", which is honest and is what the build console already warned about.
 */
const KOFFI_PACKAGE_FILES = ["package.json", "index.js", "indirect.js"] as const;
/** Kept in step with `SHIPPED_KOFFI_DIRECTORY` in `@shared/utils/systemCursor`. */
const SHIPPED_KOFFI_DIR_NAME = "koffi";

/**
 * Which koffi prebuild directories a build target needs.
 *
 * Two vocabularies meet here and they only look alike. A build target is
 * `<GameBuildDesktopPlatform>-<GameBuildArch>` - `windows-x64`, `macos-arm64` - while koffi names
 * its directories after Node's `process.platform`: `win32_x64`, `darwin_arm64`. Substituting the
 * separator produced `windows_x64`, which is not a directory koffi ships, so the copy found nothing
 * and returned quietly: every packaged game shipped without the addon and reported the cursor as
 * unmovable, on all three platforms, with nothing anywhere saying why. Hence a table and a test
 * rather than string surgery.
 *
 * A macOS universal build needs both slices, which is why this answers a list.
 */
const KOFFI_PLATFORM_DIRECTORIES: Readonly<Record<string, string>> = {
    windows: "win32",
    macos: "darwin",
    linux: "linux",
};

export function koffiPrebuildDirectories(platformKey: string | undefined): string[] {
    if (!platformKey) {
        // No build target named: a Dev Mode compile aimed at this host, where koffi's vocabulary is
        // the one `process` already speaks.
        return [`${process.platform}_${process.arch}`];
    }
    const separator = platformKey.lastIndexOf("-");
    if (separator <= 0) {
        return [];
    }
    const directory = KOFFI_PLATFORM_DIRECTORIES[platformKey.slice(0, separator)];
    const arch = platformKey.slice(separator + 1);
    if (!directory || !arch) {
        return [];
    }
    return arch === "universal"
        ? [`${directory}_x64`, `${directory}_arm64`]
        : [`${directory}_${arch}`];
}

/**
 * koffi, for the Move Mouse family.
 *
 * The packaged game's main process needs an FFI to position the system cursor, and koffi is the one
 * this application already depends on and already signs. It cannot be bundled - it resolves its own
 * `.node` by path at run time - so it ships as a package directory beside the game's `main.js`,
 * the way `bindings.js`/`vendor.js` ship for the addon.
 *
 * Only the prebuilds for the target are copied. The package carries eighteen of them and weighs
 * 24 MB; a game needs one (two for a universal macOS build), and shipping the rest would put an ARM
 * Linux binary inside every Windows installer.
 *
 * A target koffi has no prebuild for is not an error - the game degrades to "this host cannot move
 * the cursor", which the build console already warned about for non-desktop targets. It does say so
 * on the compile log, because the previous version of this said nothing and that is how it shipped
 * broken.
 */
async function copyKoffiPackage(destinationDir: string, platformKey: string | undefined): Promise<void> {
    const directories = koffiPrebuildDirectories(platformKey);
    if (directories.length === 0) {
        console.warn(`[Compile] no koffi prebuild is known for "${platformKey}"; the game cannot move the cursor`);
        return;
    }
    let packageRoot: string;
    try {
        packageRoot = path.dirname(unpackAsarPath(createRequire(__filename).resolve("koffi/package.json")));
    } catch (error) {
        // Studio's own install is missing it. The game simply reports the cursor as unmovable.
        console.warn("[Compile] koffi is not resolvable from this installation", error);
        return;
    }
    const targetRoot = path.join(destinationDir, SHIPPED_KOFFI_DIR_NAME);
    const copied: string[] = [];
    for (const directory of directories) {
        const prebuild = path.join(packageRoot, "build", "koffi", directory, "koffi.node");
        try {
            await fs.access(prebuild);
        } catch {
            continue;
        }
        await fs.mkdir(path.join(targetRoot, "build", "koffi", directory), { recursive: true });
        await fs.copyFile(prebuild, path.join(targetRoot, "build", "koffi", directory, "koffi.node"));
        copied.push(directory);
    }
    if (copied.length === 0) {
        console.warn(
            `[Compile] koffi ships no prebuild for ${directories.join(", ")}; the game cannot move the cursor`,
        );
        return;
    }
    for (const fileName of KOFFI_PACKAGE_FILES) {
        await copyOptionalFile(path.join(packageRoot, fileName), path.join(targetRoot, fileName));
    }
}

async function copyOptionalFile(sourcePath: string, targetPath: string): Promise<void> {
    try {
        await fs.copyFile(sourcePath, targetPath);
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return;
        }
        throw error;
    }
}

/**
 * Which library assets this build may carry, and the bundle narrowed to match.
 *
 * The answer is every asset id that occurs in the bytes that ship. Three of the bundle's own tables
 * enumerate over the whole project rather than over what the story reaches - the display names a
 * story row shows, the clip regions marked on audio, and the cast list - so each would answer "all
 * of them" whatever the story does. They are held out of the sweep and narrowed to its result, which
 * is sound because a subset adds no id back.
 *
 * The cast is narrowed *before* the asset sweep rather than after it, and that ordering is the whole
 * point: a character sheet names every portrait, pose and avatar that character has, so a cast list
 * narrowed afterwards would already have kept the portraits of a character this edition cannot
 * reach. That was the last hole in "the demo does not carry the rest of the game".
 *
 * What this cannot see is an id the running game computes rather than stores. That is refused before
 * a build starts rather than guessed at here: an asset picked by an expression is exactly the shape
 * that would go missing from a shipped game with nothing anywhere saying so.
 */
async function planShippedAssets(
    projectPath: string,
    bundle: DevModeBundle,
    runtimePlugins: readonly GameRuntimePluginSource[],
    onNotice?: (message: string) => void,
    assetReplacements?: Readonly<Record<string, OptimizedAssetFile>>,
): Promise<{
    bundle: DevModeBundle;
    include: Set<string>;
    characterIds: Set<string>;
    report: ShippedAssetReport;
}> {
    const library = await readLibraryAssetRecords(projectPath);
    const libraryAssetIds = new Set(library.keys());
    // A plugin's published data ships inside the pack and a plugin can ask for an asset's URL, so a
    // catalogue naming one is a reference like any other. It is swept from the same files the plugin
    // copier reads rather than from its output, because that copier runs after the assets are chosen.
    const pluginData = await Promise.all(runtimePlugins.map(plugin => readPublishedPluginData({
        projectPath,
        manifest: plugin.manifest,
    })));
    const cast = planShippedCharacters(bundle, pluginData, onNotice);
    const assetNames = cast.bundle.storyLibrary?.assetNames ?? {};
    const clips = cast.bundle.audio?.clips ?? {};
    const swept = {
        bundle: {
            ...cast.bundle,
            ...(cast.bundle.storyLibrary
                ? { storyLibrary: { ...cast.bundle.storyLibrary, assetNames: {} } }
                : {}),
            ...(cast.bundle.audio ? { audio: { ...cast.bundle.audio, clips: {} } } : {}),
        },
        pluginData,
    };
    const include = collectReferencedAssetIds(swept, libraryAssetIds);
    return {
        bundle: {
            ...cast.bundle,
            ...(cast.bundle.storyLibrary
                ? {
                    storyLibrary: {
                        ...cast.bundle.storyLibrary,
                        assetNames: restrictRecordToAssetIds(assetNames, include).record,
                    },
                }
                : {}),
            ...(cast.bundle.audio
                ? { audio: { ...cast.bundle.audio, clips: restrictRecordToAssetIds(clips, include).record } }
                : {}),
        },
        include,
        characterIds: cast.characterIds,
        report: await describeShippedAssets({
            library,
            include,
            characters: bundle.storyLibrary?.characters ?? [],
            shippedCharacterIds: cast.characterIds,
            ...(assetReplacements ? { assetReplacements } : {}),
        }),
    };
}

/**
 * What this build carried out of the library and what it left behind, as an author reads it.
 *
 * Measured rather than counted: the number that answers "should this asset have shipped" is the
 * name, and the number that answers "was leaving it out worth anything" is its size. Both lists are
 * ordered largest first, because the entry worth looking at in a list of four hundred is the one
 * that costs the most.
 *
 * A size that cannot be read is left absent rather than reported as zero. An asset shown as "0 B"
 * reads as an empty file, which is a different problem from one nobody could measure.
 */
async function describeShippedAssets(input: {
    library: ReadonlyMap<string, LibraryAssetRecord>;
    include: ReadonlySet<string>;
    characters: readonly { id: string; name?: string }[];
    shippedCharacterIds: ReadonlySet<string>;
    assetReplacements?: Readonly<Record<string, OptimizedAssetFile>>;
}): Promise<ShippedAssetReport> {
    const included: ShippedAssetReportEntry[] = [];
    const excluded: ShippedAssetReportEntry[] = [];
    for (const [assetId, record] of input.library) {
        const carried = input.include.has(assetId);
        // What the package holds for an asset it carried, what the project holds for one it did
        // not: a re-encoded image ships as the smaller file, and reporting its source size would
        // credit the build with bytes it never wrote.
        const measured = carried
            ? input.assetReplacements?.[assetId]?.path ?? record.sourcePath
            : record.sourcePath;
        const bytes = await measureAssetBytes(measured);
        const entry: ShippedAssetReportEntry = {
            id: assetId,
            name: record.name,
            type: record.type,
            ...(bytes === undefined ? {} : { bytes }),
        };
        (carried ? included : excluded).push(entry);
    }
    const bySize = (a: ShippedAssetReportEntry, b: ShippedAssetReportEntry): number =>
        (b.bytes ?? 0) - (a.bytes ?? 0) || a.name.localeCompare(b.name);
    included.sort(bySize);
    excluded.sort(bySize);
    return {
        included,
        excluded,
        excludedCharacters: input.characters
            .filter(character => !input.shippedCharacterIds.has(character.id))
            .map(character => ({ id: character.id, name: character.name?.trim() || character.id })),
        includedBytes: totalShippedAssetBytes(included),
        excludedBytes: totalShippedAssetBytes(excluded),
    };
}

/**
 * Bytes at `target`, or undefined when it cannot be read.
 *
 * A model bundle is a directory, and its size is the sum of the files that would ship out of it -
 * the same walk the copier uses, so the two agree about what a bundle is made of.
 */
async function measureAssetBytes(target: string): Promise<number | undefined> {
    try {
        const stats = await fs.stat(target);
        if (stats.isFile()) {
            return stats.size;
        }
        if (!stats.isDirectory()) {
            return undefined;
        }
        let total = 0;
        for (const relative of await listBundleFiles(target)) {
            total += (await fs.stat(path.join(target, ...relative.split("/")))).size;
        }
        return total;
    } catch {
        return undefined;
    }
}

/**
 * The cast this edition can reach, and the bundle narrowed to it.
 *
 * A character ships when its id occurs in the bytes that ship - a story row that speaks as it, a
 * widget bound to it, a plugin catalogue naming it. The cast list itself is held out of that sweep
 * for the reason the asset-name table is: it lists every character by construction.
 *
 * The display names go with them. A `char:` translation unit belongs to a character rather than to a
 * row, so the scene drop never touched one, and an edition that stopped shipping a character was
 * still shipping that character's name in every language it carried - often the spoiler that got the
 * character dropped in the first place.
 *
 * Exported for its own test: reaching this through a whole compile would mean writing a project on
 * disk to assert a set operation.
 */
export function planShippedCharacters(
    bundle: DevModeBundle,
    pluginData: unknown,
    onNotice?: (message: string) => void,
): { bundle: DevModeBundle; characterIds: Set<string> } {
    const storyLibrary = bundle.storyLibrary;
    const characters = storyLibrary?.characters;
    if (!storyLibrary || !characters || characters.length === 0) {
        return { bundle, characterIds: new Set<string>() };
    }
    const knownIds = new Set(characters.map(character => character.id));
    // The name table is the second list that enumerates the cast: every `char:` unit id *is* a
    // character id, so sweeping it would answer "all of them" the way the asset-name table does.
    // Held out with the same call that narrows it later, against the empty set.
    const sweptLocalization = bundle.localization
        ? restrictCharacterUnits(bundle.localization, new Set<string>()).bundle
        : undefined;
    const swept = {
        bundle: {
            ...bundle,
            storyLibrary: { ...storyLibrary, characters: [] },
            ...(sweptLocalization ? { localization: sweptLocalization } : {}),
        },
        pluginData,
    };
    const characterIds = collectReferencedIds(swept, knownIds);
    if (characterIds.size === characters.length) {
        return { bundle, characterIds };
    }
    const kept = characters.filter(character => characterIds.has(character.id));
    onNotice?.(`${characters.length - kept.length} characters are unreachable in this edition and do not ship`);
    const localization = bundle.localization
        ? restrictCharacterUnits(bundle.localization, characterIds)
        : null;
    if (localization && localization.removedUnitCount > 0) {
        onNotice?.(`${localization.removedUnitCount} character names belong to characters that do not ship`);
    }
    return {
        bundle: {
            ...bundle,
            storyLibrary: { ...storyLibrary, characters: kept },
            ...(localization ? { localization: localization.bundle } : {}),
        },
        characterIds,
    };
}

/**
 * Drop the bundle's author-facing asset name table from a shipped game.
 *
 * `storyLibrary.assetNames` exists so the Dev Mode debug panel can print `Set background
 * outside_s.jpg` instead of a uuid. Nothing in a player's copy reads it, and it is a straight
 * `assetId → filename` map over every asset a story row can name - which is exactly the table
 * {@link shippedAssetManifest} takes away, arriving by a different door.
 */
function shippedBundle(bundle: DevModeBundle, mode: "preview" | "production"): DevModeBundle {
    if (mode !== "production" || !bundle.storyLibrary) {
        return bundle;
    }
    return { ...bundle, storyLibrary: { ...bundle.storyLibrary, assetNames: {} } };
}

/**
 * Narrow the compiler's asset manifest to what the artifact is allowed to say about its own
 * contents.
 *
 * The compiler needs a full manifest while it works - it copies by it, audits by it, and reports
 * counts from it - but almost none of that belongs in a shipped game. A player's copy answers
 * "what is in here" to anyone holding it, and the answer is the one thing asset protection cannot
 * take back later: bytes can be sealed, a list of what those bytes are cannot be unlearned.
 *
 * So a production artifact ships the least its own runtime can work from:
 * - **protected**: nothing at all. Store entry names are `assets/{id}`, derived at read time from
 *   an id the caller already has, so the runtime never needed the table and its absence costs
 *   nothing. Dumping the store now yields unnamed blobs and no way to tell a UI arrow from an
 *   ending CG without opening every one.
 * - **unprotected**: only what the files on disk already give away. The bytes are loose under
 *   `assets/` under those very names, so the id, its kind and its extension are readable with a
 *   directory listing and withholding them protects nothing. The rest - the authoring name, the
 *   path it was imported from, the content hash - has no counterpart on disk, and is dropped.
 *
 * Preview and test artifacts keep everything: they never leave the machine that made them, and the
 * dev-mode surfaces read this to name what they report.
 */
function shippedAssetManifest(
    manifest: Record<string, GameRuntimeAssetManifestEntry>,
    mode: "preview" | "production",
    sealed: boolean,
): GameRuntimePackV1["assets"] {
    // Which ids are bundles survives the strip; what their entry files are called does not. The
    // renderer has to pick a URL shape synchronously and membership is the least that answers that,
    // while the path it used to carry now lives in the payload under a derived key.
    const modelBundles = Object.entries(manifest)
        .filter(([, entry]) => entry.bundleEntry)
        .map(([key]) => key);
    const withModelBundles = (items: Record<string, GameRuntimeAssetManifestEntry>) => ({
        items,
        ...(modelBundles.length > 0 ? { modelBundles } : {}),
    });

    if (mode !== "production") {
        return withModelBundles(manifest);
    }
    if (sealed) {
        return withModelBundles({});
    }
    const items: Record<string, GameRuntimeAssetManifestEntry> = {};
    for (const [key, entry] of Object.entries(manifest)) {
        items[key] = {
            id: entry.id,
            relativePath: entry.relativePath,
            ...(entry.type ? { type: entry.type } : {}),
            ...(entry.ext ? { ext: entry.ext } : {}),
            ...(entry.mimeType ? { mimeType: entry.mimeType } : {}),
            // Kept on an unprotected pack only, where it is how the runtime and the web shell find
            // a bundle's entry: those builds keep their manifest, and their files are loose on disk
            // under these very names, so withholding it would hide nothing from anyone.
            ...(entry.bundleEntry ? { bundleEntry: entry.bundleEntry } : {}),
        };
    }
    return withModelBundles(items);
}

/** One entry of the project's asset library, as the trimming pass and its report need it. */
type LibraryAssetRecord = {
    name: string;
    type: string;
    /** Where the project keeps the bytes: a file, or a directory for a model bundle. */
    sourcePath: string;
};

/**
 * The whole asset library, keyed by id.
 *
 * Read once and used twice: the ids decide what the sweep is allowed to keep, and the names and
 * paths are what the build's report names an asset by. Reading it a second time to answer the
 * second question would be a second reading of the same shards that could disagree with the first.
 */
async function readLibraryAssetRecords(projectPath: string): Promise<Map<string, LibraryAssetRecord>> {
    const records = new Map<string, LibraryAssetRecord>();
    for (const type of ASSET_TYPES) {
        const metadata = await readOptionalJson<Record<string, AssetMetadataRecord>>(
            path.join(projectPath, "assets", `assets.metadata.${type}.json`),
        );
        for (const [assetId, rawAsset] of Object.entries(metadata ?? {})) {
            const normalized = normalizeAssetRecord(assetId, type, rawAsset);
            records.set(assetId, {
                name: normalized.name,
                type,
                sourcePath: resolveAssetSourcePath(projectPath, normalized),
            });
        }
    }
    return records;
}

async function copyProjectAssets(input: {
    projectPath: string;
    assetsDir: string;
    target: PackTarget;
    /**
     * The ids this build is allowed to carry, or null to carry the library whole.
     *
     * Null is the release edition and every preview: nothing was removed from the story, so no asset
     * can have lost its last reference, and narrowing there could only ever take something away.
     */
    include: ReadonlySet<string> | null;
    assetReplacements?: Readonly<Record<string, OptimizedAssetFile>>;
}): Promise<Record<string, GameRuntimeAssetManifestEntry>> {
    const manifest: Record<string, GameRuntimeAssetManifestEntry> = {};
    /*
     * Every type's registry is read before any asset moves, so the count is known
     * before the first copy rather than discovered while copying.
     *
     * This is the step a protected build spends its time in - the library is
     * where the gigabytes are - so it is the one worth being able to report a
     * real fraction for. The registries are small JSON files listing what the
     * project owns; reading them up front costs nothing and is what turns "still
     * working" into "412 of 900".
     */
    const registries: Array<[typeof ASSET_TYPES[number], Record<string, AssetMetadataRecord>]> = [];
    for (const type of ASSET_TYPES) {
        const metadataPath = path.join(input.projectPath, "assets", `assets.metadata.${type}.json`);
        const metadata = await readOptionalJson<Record<string, AssetMetadataRecord>>(metadataPath);
        if (metadata) {
            registries.push([type, metadata]);
        }
    }
    /* Counted the same way the loop below decides, so the denominator describes
     * the work that will actually happen rather than the library's size. */
    const shipping = registries.reduce((sum, [, metadata]) => sum + Object.keys(metadata)
        .filter(assetId => !input.include || input.include.has(assetId)).length, 0);
    const counted = countBuildStep(shipping, "file");
    try {
    for (const [type, metadata] of registries) {
        for (const [assetId, rawAsset] of Object.entries(metadata)) {
            if (input.include && !input.include.has(assetId)) {
                continue;
            }
            const normalized = normalizeAssetRecord(assetId, type, rawAsset);
            const sourcePath = resolveAssetSourcePath(input.projectPath, normalized);
            if (BUNDLE_ASSET_TYPES.has(type)) {
                Object.assign(manifest, await copyAssetBundle({
                    ...input,
                    type,
                    normalized,
                    sourceDir: sourcePath,
                    authoredEntry: readAuthoredBundleEntry(rawAsset),
                }));
                /* A bundle is one library entry however many files it expands
                 * into, which is what the denominator counted. */
                counted.advance();
                continue;
            }
            const sourceLabel = normalized.source === "remote" ? "remote asset" : "local asset";
            // An image the build re-encoded ships from Studio's cache, under the
            // extension and media type of what it was re-encoded into. Nothing
            // else about it moves: `hash` and `originalRelativePath` describe the
            // file in the author's project this asset came from, which is exactly
            // as true afterwards, and they are the only trail from a shipped
            // asset back to its source. See `optimizeProjectImages`.
            const optimized = input.assetReplacements?.[normalized.id];
            const payloadPath = optimized?.path ?? sourcePath;
            const ext = optimized?.ext ?? normalized.ext;
            // The MIME type is derived from the extension, not from where the
            // bytes land, so it is available even when the store keeps the item
            // under an extension-free name.
            const mimeType = optimized?.mimeType ?? getMimeType(`${normalized.id}.${normalized.ext}`);
            let relativePath: string;
            try {
                if (input.target.kind === "sealed") {
                    // Extension-free entry name: an item's media type is not
                    // recoverable from the store.
                    relativePath = gameRuntimeBundleAssetEntry(normalized.id);
                    await input.target.writer.add(relativePath, await fs.readFile(payloadPath));
                } else {
                    relativePath = path.join("assets", `${normalized.id}.${ext}`).replace(/\\/g, "/");
                    await fs.copyFile(payloadPath, path.join(input.assetsDir, `${normalized.id}.${ext}`));
                }
            } catch (error) {
                throw new Error(
                    `Failed to copy ${sourceLabel} "${normalized.name}" (${normalized.id}) from ${payloadPath}: ` +
                    `${error instanceof Error ? error.message : String(error)}`,
                );
            }
            manifest[normalized.id] = {
                id: normalized.id,
                type,
                name: normalized.name,
                source: normalized.source === "remote" ? "remote" : "local",
                relativePath,
                originalRelativePath: path.relative(input.projectPath, sourcePath).replace(/\\/g, "/"),
                hash: normalized.hash,
                ext,
                mimeType,
            };
            counted.advance();
        }
    }
    } finally {
        /* Ends the step whether the copy finished or threw: a bar left at 412 of
         * 900 after a failed build describes a build that is still running. */
        counted.end();
    }
    return manifest;
}

/**
 * Copy one model bundle into the pack: **every file**, keyed `{assetId}/{pathInsideBundle}`.
 *
 * The whole tree ships because a model's manifest is the only thing that knows which files matter -
 * Hiyori names one of its motions solely under `TapBody`, so the root listing does not imply the
 * file set - and Studio deliberately never parses that manifest. Copying "what looks relevant" is
 * not something that can be done correctly here.
 *
 * The key scheme is what makes the runtime work unchanged: `nlgame://asset/{id}/{rel}` and the web
 * shell's `./assets/{id}/{rel}` both resolve by manifest key, so `resolveSibling()` arithmetic
 * against the served entry URL lands on a key that exists. The bare `{id}` also gets an entry,
 * pointing at the entry file, so a caller holding only the asset id still reaches the manifest.
 *
 * One manifest entry per file follows the precedent set by `copyBakedCharacterAvatars`, which
 * already expands one project artifact into N entries under synthetic ids.
 */
async function copyAssetBundle(input: {
    projectPath: string;
    assetsDir: string;
    target: PackTarget;
    type: string;
    normalized: ReturnType<typeof normalizeAssetRecord>;
    sourceDir: string;
    authoredEntry?: string;
}): Promise<Record<string, GameRuntimeAssetManifestEntry>> {
    const { normalized, sourceDir } = input;
    const manifest: Record<string, GameRuntimeAssetManifestEntry> = {};

    let files: string[];
    try {
        files = sortBundlePaths(await listBundleFiles(sourceDir));
    } catch (error) {
        throw new Error(
            `Failed to read model bundle "${normalized.name}" (${normalized.id}) at ${sourceDir}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
    }
    if (files.length === 0) {
        throw new Error(`Model bundle "${normalized.name}" (${normalized.id}) is empty at ${sourceDir}`);
    }

    const authored = input.authoredEntry ? normalizeBundlePath(input.authoredEntry) : null;
    const entry = authored && files.includes(authored)
        ? authored
        : detectModelBundleEntry(files).entry;
    if (!entry) {
        // A hard failure, not a warning: a bundle with no entry is an asset the engine cannot mount,
        // and shipping it produces a game that breaks at the character's first appearance with no
        // trace back to the build.
        throw new Error(
            `Model bundle "${normalized.name}" (${normalized.id}) has no entry file. ` +
            "Choose one in the asset inspector before building.",
        );
    }

    const makeEntry = (key: string, relativePath: string, filePath: string): GameRuntimeAssetManifestEntry => ({
        id: key,
        type: input.type,
        name: key === normalized.id ? normalized.name : `${normalized.name}/${filePath}`,
        source: "local",
        relativePath,
        originalRelativePath: path.relative(input.projectPath, path.join(sourceDir, filePath)).replace(/\\/g, "/"),
        hash: key === normalized.id ? normalized.hash : undefined,
        mimeType: getMimeType(filePath),
    });

    let entryRelativePath = "";
    for (const filePath of files) {
        const key = `${normalized.id}/${filePath}`;
        const absolute = path.join(sourceDir, ...filePath.split("/"));
        let relativePath: string;
        try {
            if (input.target.kind === "sealed") {
                relativePath = gameRuntimeBundleAssetEntry(key);
                await input.target.writer.add(relativePath, await fs.readFile(absolute));
            } else {
                relativePath = path.posix.join("assets", key);
                const destination = path.join(input.assetsDir, normalized.id, ...filePath.split("/"));
                await fs.mkdir(path.dirname(destination), { recursive: true });
                await fs.copyFile(absolute, destination);
            }
        } catch (error) {
            throw new Error(
                `Failed to copy model bundle file "${filePath}" of "${normalized.name}" (${normalized.id}) ` +
                `from ${absolute}: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        manifest[key] = makeEntry(key, relativePath, filePath);
        if (filePath === entry) {
            entryRelativePath = relativePath;
        }
    }

    // The bare id resolves to the entry file, and carries the entry path so a caller holding only
    // the id can build a URL the bundle's own relative references resolve against.
    manifest[normalized.id] = {
        ...makeEntry(normalized.id, entryRelativePath, entry),
        bundleEntry: entry,
    };

    // In a protected pack the manifest does not ship, so the entry path is written into the payload
    // instead, at the address the runtime derives from the id alone. That is what lets a shipped
    // game mount this model while stating nowhere what its entry file is called - the file name of
    // a character's model is usually the character's name.
    if (input.target.kind === "sealed") {
        await input.target.writer.add(
            gameRuntimeBundleModelEntry(normalized.id),
            Buffer.from(JSON.stringify({ e: entry }), "utf-8"),
        );
    }

    return manifest;
}

/** Every regular file under `root`, relative and `/`-separated. */
async function listBundleFiles(root: string, prefix = ""): Promise<string[]> {
    const collected: string[] = [];
    for (const dirent of await fs.readdir(root, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${dirent.name}` : dirent.name;
        if (dirent.isDirectory()) {
            collected.push(...await listBundleFiles(path.join(root, dirent.name), relative));
        } else if (dirent.isFile()) {
            const normalized = normalizeBundlePath(relative);
            if (normalized) {
                collected.push(normalized);
            }
        }
    }
    return collected;
}

function readAuthoredBundleEntry(rawAsset: AssetMetadataRecord): string | undefined {
    const extras = rawAsset?.extras as { modelEntry?: unknown } | undefined;
    return typeof extras?.modelEntry === "string" && extras.modelEntry.trim()
        ? extras.modelEntry.trim()
        : undefined;
}

/**
 * Copy `resources/characters/avatars/<characterId>/<key>.png` into the pack, one manifest entry
 * per file under the same synthetic id the story compiler resolves.
 *
 * Missing directory is not an error: a project whose characters have no avatars simply has none.
 */
async function copyBakedCharacterAvatars(input: {
    projectPath: string;
    assetsDir: string;
    target: PackTarget;
    manifest: Record<string, GameRuntimeAssetManifestEntry>;
    /**
     * The cast this edition ships, or null when it ships all of them.
     *
     * These bakes are derived project files rather than library assets, so the asset sweep never
     * sees them and narrowing the cast would not have taken them away: a directory per character
     * sits on disk, and this walk would copy every one of them into a demo.
     */
    characterIds: ReadonlySet<string> | null;
    assetReplacements?: Readonly<Record<string, OptimizedAssetFile>>;
}): Promise<void> {
    const root = path.join(input.projectPath, "resources", "characters", "avatars");
    let characterDirs: string[];
    try {
        characterDirs = (await fs.readdir(root, { withFileTypes: true }))
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);
    } catch {
        return;
    }

    for (const characterId of characterDirs) {
        if (input.characterIds && !input.characterIds.has(characterId)) {
            continue;
        }
        const dir = path.join(root, characterId);
        const files = (await fs.readdir(dir)).filter(name => name.toLowerCase().endsWith(".png"));
        for (const fileName of files) {
            const key = fileName.slice(0, -".png".length);
            const id = characterAvatarAssetId(characterId, key);
            const sourcePath = path.join(dir, fileName);
            // Re-encoded like any other image, and by the same pass: a bake is a
            // PNG shown on almost every line of dialogue.
            const optimized = input.assetReplacements?.[id];
            const payloadPath = optimized?.path ?? sourcePath;
            const ext = optimized?.ext ?? "png";
            let relativePath: string;
            if (input.target.kind === "sealed") {
                relativePath = gameRuntimeBundleAssetEntry(id);
                input.target.writer.add(relativePath, await fs.readFile(payloadPath));
            } else {
                // The synthetic id carries characters (`:`) a file name may not, so the copy is
                // named after the bake path it came from rather than after the id.
                const flatName = `character-avatar-${characterId}-${key}.${ext}`;
                relativePath = path.join("assets", flatName).replace(/\\/g, "/");
                await fs.copyFile(payloadPath, path.join(input.assetsDir, flatName));
            }
            input.manifest[id] = {
                id,
                type: "image",
                name: `${characterId}/${key}`,
                source: "local",
                relativePath,
                originalRelativePath: path.relative(input.projectPath, sourcePath).replace(/\\/g, "/"),
                ext,
                mimeType: optimized?.mimeType ?? "image/png",
            };
        }
    }
}

/**
 * Copy the baked weather clips this pack's stories still reach, one manifest entry each.
 *
 * ## Why the narrowing happens here and not at the baker
 *
 * The offered list is what the *project* asks for; a variant that dropped the scene with the snow in
 * it must not carry the snow. The shipped bundle is the first place that is knowable, because it is
 * the fold and the scene drop applied. Re-walking it costs one pass over documents already in memory.
 *
 * ## Why an id with no clip is silent
 *
 * A clip that could not be produced was already logged where the encoder failed, and the compile
 * that runs inside the shipped game reports it on the row that wanted it. Repeating it here would
 * name a file rather than a row, which is the wrong end for an author.
 */
async function copyWeatherClips(input: {
    clips: readonly PackedWeatherClip[];
    bundle: DevModeBundle;
    assetsDir: string;
    target: PackTarget;
    manifest: Record<string, GameRuntimeAssetManifestEntry>;
}): Promise<void> {
    if (input.clips.length === 0) {
        return;
    }
    const reached = new Set(
        collectWeatherSpecs(
            Object.values(input.bundle.storyLibrary?.documents ?? {}),
            input.bundle.ui.uidoc,
            // The bundle's copy of the project's frame rate, which is also what the shipped game
            // will compute its ids from. Taking it from anywhere else is how a package comes to
            // carry a clip under an id nothing in it ever asks for.
            input.bundle.vfx,
        ).map(weatherClipAssetId),
    );
    for (const clip of input.clips) {
        if (!reached.has(clip.id)) {
            continue;
        }
        const fileName = `${clip.id.replace(/[^\w.-]+/g, "-")}.webm`;
        let relativePath: string;
        if (input.target.kind === "sealed") {
            relativePath = gameRuntimeBundleAssetEntry(clip.id);
            input.target.writer.add(relativePath, await fs.readFile(clip.path));
        } else {
            relativePath = path.posix.join("assets", fileName);
            await fs.copyFile(clip.path, path.join(input.assetsDir, fileName));
        }
        input.manifest[clip.id] = {
            id: clip.id,
            type: "video",
            name: path.basename(clip.path),
            source: "local",
            relativePath,
            ext: "webm",
            mimeType: "video/webm",
        };
    }
}

/**
 * Copy the project's puppet backends into the pack, one directory per backend.
 *
 * The whole directory travels, not just `index.js`: a backend is free to keep
 * shader sources, a wasm blob or a licence file beside its entry and reach them
 * through the host's `resolveFile`, exactly as it does in Dev Mode.
 *
 * A project with no `runtimes/puppet/` is the normal case and not an error. A
 * directory with no `index.js` is skipped with a warning rather than failing the
 * build: it is indistinguishable from a half-finished install, and the pack is
 * still a working game for every character that does not use it.
 */
async function copyPuppetRuntimes(input: {
    appDir: string;
    projectPath: string;
    target: PackTarget;
}): Promise<GameRuntimePackPuppetRuntimeEntry[]> {
    const root = path.join(input.projectPath, ...PUPPET_RUNTIMES_PROJECT_DIR);
    let dirents;
    try {
        dirents = await fs.readdir(root, { withFileTypes: true });
    } catch {
        return [];
    }
    const entries: GameRuntimePackPuppetRuntimeEntry[] = [];
    for (const dirent of dirents.filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
        const sourceDir = path.join(root, dirent.name);
        const files = sortBundlePaths(await listBundleFiles(sourceDir));
        if (!files.includes(PUPPET_RUNTIME_ENTRY_FILE)) {
            console.warn(
                "[gameRuntimeArtifactCompiler]",
                `puppet runtime "${dirent.name}" has no ${PUPPET_RUNTIME_ENTRY_FILE}; it is not packaged`,
            );
            continue;
        }
        for (const file of files) {
            const relativePath = path.posix.join(PUPPET_RUNTIMES_PACK_DIR, dirent.name, file);
            const sourcePath = path.join(sourceDir, ...file.split("/"));
            try {
                if (input.target.kind === "sealed") {
                    await input.target.writer.add(gameRuntimeBundleRuntimeEntry(relativePath), await fs.readFile(sourcePath));
                } else {
                    const targetPath = path.join(input.appDir, ...relativePath.split("/"));
                    await fs.mkdir(path.dirname(targetPath), { recursive: true });
                    await fs.copyFile(sourcePath, targetPath);
                }
            } catch (error) {
                throw new Error(
                    `Failed to copy puppet runtime "${dirent.name}" file ${file} from ${sourcePath}: ` +
                    `${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
        entries.push({
            name: dirent.name,
            entryRelativePath: path.posix.join(PUPPET_RUNTIMES_PACK_DIR, dirent.name, PUPPET_RUNTIME_ENTRY_FILE),
            files: files.filter(file => file !== PUPPET_RUNTIME_ENTRY_FILE),
        });
    }
    return entries;
}

async function copyRuntimePlugins(input: {
    appDir: string;
    projectPath: string;
    runtimePlugins: GameRuntimePluginSource[];
    target: PackTarget;
    /**
     * Every target this pack serves. Empty on web compiles only - a static site
     * has no process to spawn. A preview passes the host's own key and does ship
     * sidecars, which is the point: exercising one should not cost a full
     * production build.
     */
    platformKeys: readonly string[];
    /** Where one target's files go. See perTargetPayload.ts. */
    destinationDirFor: (platformKey: string) => string;
    hostCacheRoot?: string;
    /** The author's download rewrites, for the same reason `hostCacheRoot` travels. */
    downloadRewrites?: readonly DownloadRewriteRule[];
    /** What each plugin's declared fields resolve against. See {@link readPluginConfigSource}. */
    pluginConfig: { tag: ProjectAppTag; base: AppTagPluginConfig };
    /** The build targets this artifact serves; what a platform-scoped field resolves against. */
    platforms?: readonly GameBuildPlatform[];
    onNotice?: (message: string) => void;
}): Promise<GameRuntimePackPluginEntry[]> {
    const entries: GameRuntimePackPluginEntry[] = [];
    for (const plugin of input.runtimePlugins) {
        const relativePath = path.posix.join("plugins", plugin.manifest.id, ...plugin.entry.split("/"));
        try {
            if (input.target.kind === "sealed") {
                await input.target.writer.add(gameRuntimeBundleRuntimeEntry(relativePath), await fs.readFile(plugin.entryPath));
            } else {
                const targetPath = path.join(input.appDir, ...relativePath.split("/"));
                await fs.mkdir(path.dirname(targetPath), { recursive: true });
                await fs.copyFile(plugin.entryPath, targetPath);
            }
        } catch (error) {
            throw new Error(
                `Failed to copy runtime entry of plugin "${plugin.manifest.id}" from ${plugin.entryPath}: ` +
                `${error instanceof Error ? error.message : String(error)}`,
            );
        }
        const data = await readPublishedPluginData({
            projectPath: input.projectPath,
            manifest: plugin.manifest,
            onWarning: message => console.warn("[gameRuntimeArtifactCompiler]", message),
        });
        /*
         * Every target this pack serves, each into its own staging directory.
         * The answers are merged below: one sidecar becomes one pack entry that
         * names a file per machine, so a Windows package and a Linux package
         * built together each spawn their own.
         */
        const perTarget: GameRuntimePackSidecarEntry[][] = [];
        for (const platformKey of input.platformKeys) {
            perTarget.push(await copyPluginSidecars({
                destinationDir: input.destinationDirFor(platformKey),
                plugin,
                platformKey,
                ...(input.hostCacheRoot ? { hostCacheRoot: input.hostCacheRoot } : {}),
                ...(input.downloadRewrites ? { downloadRewrites: input.downloadRewrites } : {}),
            }));
        }
        const sidecars = mergeSidecarEntries(perTarget.flat());
        // Per plugin and nothing wider: the entry a plugin reads at runtime is its own, so a value
        // one plugin's author typed is never in front of another's code.
        const buildConfig = resolveShippedPluginBuildConfig(
            { pluginId: plugin.manifest.id, manifest: plugin.manifest },
            input.pluginConfig.tag,
            input.pluginConfig.base,
            input.platforms,
        );
        for (const key of buildConfig.ambiguousKeys) {
            // Named rather than dropped in silence: to the plugin this is indistinguishable from a
            // field the author never filled in, and only the author can decide which value is right
            // for a package that serves several platforms at once.
            input.onNotice?.(
                `${plugin.manifest.id}: "${key}" differs between the platforms this build produces, `
                + "so no value ships for it",
            );
        }
        entries.push({
            manifest: plugin.manifest,
            entryRelativePath: relativePath,
            ...(data ? { data } : {}),
            ...(sidecars.length > 0 ? { sidecars } : {}),
            ...(Object.keys(buildConfig.values).length > 0 ? { buildConfig: buildConfig.values } : {}),
        });
    }
    return entries;
}

/**
 * Copy one plugin's sidecar payload for the platform this pack is built for.
 *
 * Sidecars are ALWAYS loose files, even when the rest of the pack is sealed.
 * A sidecar is an executable image: the OS loader opens it by path, so it can
 * be neither read out of the protected store nor run from inside the asar, and
 * sealing it would only be a lie about what shipped - the bytes a player can
 * copy out of the app dir are the same either way. (buildAsarUnpackPatterns
 * keeps `sidecars/**` outside the archive for the same reason.)
 *
 * A plugin that declares no target for this platform key is not an error: the
 * contract is that its runtime degrades and `available()` answers false there.
 * Preflight warns the author before they commit to the build; here it is worth
 * only a log line.
 */
/**
 * One entry per sidecar, naming a file per machine.
 *
 * The targets are copied one at a time and each answers for itself, so a sidecar
 * a plugin ships for three platforms arrives here three times. They agree about
 * everything except which file to spawn, which is the whole reason the pack has
 * to hold a map at all.
 *
 * A pack that serves one machine collapses back to a bare string. Not for
 * tidiness: it is what every pack said before this, and a game built by an older
 * Studio reads that shape and only that shape.
 */
function mergeSidecarEntries(entries: readonly GameRuntimePackSidecarEntry[]): GameRuntimePackSidecarEntry[] {
    const merged = new Map<string, GameRuntimePackSidecarEntry>();
    for (const entry of entries) {
        const seen = merged.get(entry.id);
        if (!seen) {
            merged.set(entry.id, { ...entry, entry: { ...(entry.entry as Record<string, string>) } });
            continue;
        }
        Object.assign(seen.entry as Record<string, string>, entry.entry as Record<string, string>);
    }
    return [...merged.values()].map(entry => {
        const byMachine = entry.entry as Record<string, string>;
        const keys = Object.keys(byMachine);
        return keys.length === 1 ? { ...entry, entry: byMachine[keys[0]] } : entry;
    });
}

async function copyPluginSidecars(input: {
    /** Where this target's files go; the app root for a preview, a staged directory for a build. */
    destinationDir: string;
    plugin: GameRuntimePluginSource;
    platformKey: string;
    hostCacheRoot?: string;
    /** The author's download rewrites, for the same reason `hostCacheRoot` travels. */
    downloadRewrites?: readonly DownloadRewriteRule[];
}): Promise<GameRuntimePackSidecarEntry[]> {
    const { plugin, platformKey } = input;
    const entries: GameRuntimePackSidecarEntry[] = [];
    for (const sidecar of plugin.manifest.contributes.sidecars) {
        const target = sidecar.targets[platformKey];
        if (!target) {
            console.info(
                "[gameRuntimeArtifactCompiler]",
                `plugin "${plugin.manifest.id}" ships no "${sidecar.id}" sidecar for ${platformKey}; ` +
                "it is absent from this build",
            );
            continue;
        }
        const where = `Sidecar "${sidecar.id}" of plugin "${plugin.manifest.id}" (${platformKey})`;
        const sidecarRelativeDir = path.posix.join(SIDECAR_DIR_NAME, plugin.manifest.id, sidecar.id);
        const sidecarDir = path.join(input.destinationDir, ...sidecarRelativeDir.split("/"));
        for (const include of target.include) {
            const { sourcePath, relativePath } = await resolveSidecarInclude({
                include,
                plugin,
                platformKey,
                target,
                where,
                ...(input.hostCacheRoot ? { hostCacheRoot: input.hostCacheRoot } : {}),
                ...(input.downloadRewrites ? { downloadRewrites: input.downloadRewrites } : {}),
            });
            // The include path is also the path inside the sidecar directory
            // (minus any `dep:<id>/` prefix), so an author who needs a shared
            // library beside the executable says so by declaring it there -
            // through the dependency's own `files` mapping for a `dep:` entry.
            const targetPath = resolveInsideDir(sidecarDir, relativePath, where);
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            try {
                await fs.copyFile(sourcePath, targetPath);
            } catch (error) {
                throw new Error(
                    `${where}: could not copy "${include}" from ${sourcePath}: ` +
                    `${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
        entries.push({
            id: sidecar.id,
            /* One name per machine this target runs on. Merged with the other
             * targets' answers below; a build serving one machine collapses back
             * to a bare string, which is what every pack said before. */
            entry: Object.fromEntries(runningPlatformKeysFor(platformKey).map((key: string) => [
                key,
                path.posix.join(sidecarRelativeDir, ...normalizeSidecarPath(target.entry).split("/")),
            ])),
            kind: sidecar.kind,
            autostart: sidecar.autostart,
            startupTimeoutMs: sidecar.startupTimeoutMs,
            shutdownTimeoutMs: sidecar.shutdownTimeoutMs,
            restart: { ...sidecar.restart },
        });
    }
    return entries;
}

/**
 * Locate the bytes one `include` entry names, and say where they belong inside
 * the sidecar directory.
 *
 * A package-relative file is verified against its declared digest before it is
 * copied. The manifest validator checks the same digests at install time, but a
 * build is the last moment before those bytes reach a player's machine, and an
 * install directory is an ordinary folder anything on the host can rewrite
 * afterwards - so the pack re-verifies rather than trusts the install record.
 * `dep:` artifacts are not verified here because the build dependency cache
 * applies the same rule at its own door: it re-checks the directory it hands
 * back against what was extracted into it, not just the archive that came out
 * of the network.
 */
async function resolveSidecarInclude(input: {
    include: string;
    plugin: GameRuntimePluginSource;
    platformKey: string;
    target: { sha256: Record<string, string> };
    where: string;
    hostCacheRoot?: string;
    /** The author's download rewrites, for the same reason `hostCacheRoot` travels. */
    downloadRewrites?: readonly DownloadRewriteRule[];
}): Promise<{ sourcePath: string; relativePath: string }> {
    const { include, plugin, platformKey, where } = input;
    if (include.startsWith(SIDECAR_DEP_INCLUDE_PREFIX)) {
        const reference = include.slice(SIDECAR_DEP_INCLUDE_PREFIX.length);
        const separator = reference.indexOf("/");
        const dependencyId = separator === -1 ? reference : reference.slice(0, separator);
        const relativePath = normalizeSidecarPath(separator === -1 ? "" : reference.slice(separator + 1));
        if (!relativePath) {
            throw new Error(`${where}: include "${include}" names no file inside the build dependency`);
        }
        const dependency = plugin.manifest.contributes.buildDependencies.find(item => item.id === dependencyId);
        if (!dependency) {
            throw new Error(`${where}: include "${include}" references undeclared build dependency "${dependencyId}"`);
        }
        const dependencyTarget = dependency.targets[platformKey];
        if (!dependencyTarget) {
            throw new Error(
                `${where}: build dependency "${dependencyId}" declares nothing for ${platformKey}, ` +
                `so "${include}" cannot be shipped`,
            );
        }
        if (!input.hostCacheRoot) {
            // A programming error rather than an author's: whoever asked for a
            // sidecar platform key owes the compile a cache root as well.
            throw new Error(
                `${where}: "${include}" needs the build dependency cache, but no cache root was passed to the compile`,
            );
        }
        const dependencyDir = await ensurePluginBuildDependency({
            cacheRoot: input.hostCacheRoot,
            dependencyId,
            platformKey,
            target: dependencyTarget,
            ...(input.downloadRewrites ? { rewrites: input.downloadRewrites } : {}),
            log: (level, message) => console.info(`[gameRuntimeArtifactCompiler] ${level}:`, message),
        });
        return { sourcePath: resolveBuildDependencyFile(dependencyDir, relativePath), relativePath };
    }

    const relativePath = normalizeSidecarPath(include);
    const sourcePath = resolveInsideDir(plugin.installPath, relativePath, where);
    const expected = (input.target.sha256[include] ?? input.target.sha256[relativePath] ?? "").trim().toLowerCase();
    if (!expected) {
        throw new Error(`${where}: no sha256 is declared for "${include}", so it cannot be verified`);
    }
    let bytes: Buffer;
    try {
        bytes = await fs.readFile(sourcePath);
    } catch (error) {
        throw new Error(
            `${where}: could not read "${include}" at ${sourcePath} ` +
            `(${error instanceof Error ? error.message : String(error)})`,
        );
    }
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    if (digest !== expected) {
        throw new Error(
            `${where}: "${include}" has sha256 ${digest}, not the declared ${expected}. ` +
            "The plugin package has been modified since it was installed; reinstall it rather than ship this binary.",
        );
    }
    return { sourcePath, relativePath };
}

/** Zip and manifests speak forward slashes; authors copy paths off a Windows shell. */
function normalizeSidecarPath(value: string): string {
    return value.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").replace(/^\/+/, "");
}

/**
 * Resolve a forward-slash relative path inside `root`, refusing to escape it.
 * The manifest validator rejects escaping paths already; this is the second
 * lock, because a hand-edited install record must not be able to read or write
 * outside the package and the app dir.
 */
function resolveInsideDir(root: string, relativePath: string, where: string): string {
    const base = path.resolve(root);
    const resolved = path.resolve(base, ...relativePath.split("/").filter(segment => segment.length > 0));
    const relative = path.relative(base, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`${where}: "${relativePath}" escapes ${base}`);
    }
    return resolved;
}

async function copyProjectIcon(input: {
    projectPath: string;
    appDir: string;
    projectConfig: ProjectConfigData | null;
    defaultIcon?: { path: string; opaquePath?: string };
}): Promise<GameRuntimeProjectIcon | undefined> {
    const platform = getCurrentProjectIconPlatform();
    const configured = getProjectIconConfig(input.projectConfig, platform);
    // A project with no icon of its own runs under NarraLeaf's mark rather than
    // Electron's default, matching what its packaged build will wear.
    const icon = configured ?? (input.defaultIcon
        ? { path: input.defaultIcon.path, sourceName: path.basename(input.defaultIcon.path), mediaType: "image/png" }
        : null);
    if (!icon) {
        return undefined;
    }

    const sourcePath = configured
        ? resolveProjectRelativePath(input.projectPath, icon.path)
        : icon.path;
    const extension = normalizeExtension(path.extname(icon.path).replace(".", ""), icon.path, "other");
    const relativePath = path.join("icons", `app-icon-${platform}.${extension}`).replace(/\\/g, "/");
    const targetPath = path.join(input.appDir, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath).catch(error => {
        throw new Error(
            `Failed to copy configured ${platform} project icon from ${sourcePath}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
    });

    return {
        platform,
        relativePath,
        originalRelativePath: configured
            ? path.relative(input.projectPath, sourcePath).replace(/\\/g, "/")
            : relativePath,
        sourceName: readString(icon.sourceName),
        mediaType: readString(icon.mediaType) ?? getMimeType(targetPath),
    };
}

/**
 * The web export's own icons. Web used to have no icon of its own and borrowed
 * whichever desktop slot happened to hold a PNG, so a project that configured
 * only mobile icons shipped no favicon at all.
 *
 * A project that has not baked yet falls back to the master, and is skipped
 * unless that master is already a PNG - the link tags declare image/png and
 * Studio does no conversion on this path.
 */
async function copyWebIcons(input: {
    projectPath: string;
    appDir: string;
    projectConfig: ProjectConfigData | null;
    defaultIcon?: { path: string; opaquePath?: string };
}): Promise<{ hasFavicon: boolean; hasAppleTouchIcon: boolean }> {
    const set = readProjectIconSet(input.projectConfig);
    const copy = async (sourcePath: string, fileName: string): Promise<boolean> => {
        try {
            await fs.copyFile(sourcePath, path.join(input.appDir, fileName));
            return true;
        } catch {
            return false;
        }
    };
    /** The project's own PNG for this output, or null when it has none usable. */
    const projectIcon = (outputId: "web-favicon" | "web-apple-touch"): string | null => {
        const icon = resolveIconFile(set, outputId);
        // Non-PNG is skipped: the link tags declare image/png and this path does
        // no conversion. The un-baked apple-touch case is skipped too - falling
        // back to a master that keeps its transparency would hand Safari the
        // very icon that file exists to avoid, composited onto black.
        if (!icon || !icon.path.toLowerCase().endsWith(".png")) {
            return null;
        }
        if (outputId === "web-apple-touch" && !set.baked["web-apple-touch"]) {
            return null;
        }
        return resolveProjectRelativePath(input.projectPath, icon.path);
    };

    const favicon = projectIcon("web-favicon") ?? input.defaultIcon?.path;
    const appleTouch = projectIcon("web-apple-touch")
        ?? input.defaultIcon?.opaquePath
        ?? input.defaultIcon?.path;
    return {
        hasFavicon: favicon ? await copy(favicon, WEB_FAVICON_FILENAME) : false,
        hasAppleTouchIcon: appleTouch ? await copy(appleTouch, WEB_APPLE_TOUCH_FILENAME) : false,
    };
}

/**
 * The icon file this platform ships, read through the shared model so the
 * legacy five-slot shape and the master model resolve identically here and in
 * the build's preflight.
 */
function getProjectIconConfig(
    projectConfig: ProjectConfigData | null,
    platform: GameRuntimeProjectIconPlatform,
): { path: string; sourceName?: string; mediaType?: string } | null {
    const set = readProjectIconSet(projectConfig);
    const file = resolveIconFile(set, platform);
    if (!file) {
        return null;
    }
    const source = resolveIconSource(set, platform);
    return {
        path: file.path,
        sourceName: source?.sourceName,
        mediaType: file.baked ? "image/png" : source?.mediaType,
    };
}

function getCurrentProjectIconPlatform(): GameRuntimeProjectIconPlatform {
    if (process.platform === "darwin") {
        return "macos";
    }
    if (process.platform === "win32") {
        return "windows";
    }
    return "linux";
}

function resolveProjectRelativePath(projectPath: string, relativePath: string): string {
    const root = path.resolve(projectPath);
    const resolved = path.resolve(root, relativePath.replace(/^[/\\]+/, ""));
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw new Error(`Project path escapes project root: ${relativePath}`);
    }
    return resolved;
}

/**
 * Where an asset's bytes are, regardless of where they came from.
 *
 * One path for both sources. A remote asset used to be read out of `editor/assets/remote`, the
 * editor's download cache - which `shared/vcs/workingSet.ts` deliberately excludes from version
 * control, and which is only ever filled by previewing that asset in the editor. So a build from a
 * fresh clone, or of an asset the author had never opened, failed on a file that had never existed
 * on that machine. Remote assets now keep a versioned snapshot at the ordinary content shard, and
 * this function has nothing left to decide.
 */
function resolveAssetSourcePath(
    projectPath: string,
    asset: ReturnType<typeof normalizeAssetRecord>,
): string {
    const [a, b, rest] = splitAssetStorageId(asset.id);
    return path.join(projectPath, "assets", "content", a, b, rest);
}

function normalizeAssetRecord(assetId: string, type: string, rawAsset: AssetMetadataRecord) {
    const id = typeof rawAsset?.id === "string" && rawAsset.id.trim() ? rawAsset.id.trim() : assetId;
    splitAssetStorageId(id);
    const name = typeof rawAsset?.name === "string" && rawAsset.name.trim() ? rawAsset.name.trim() : id;
    const source = rawAsset?.source === "remote" ? "remote" : "local";
    const ext = normalizeExtension(
        typeof rawAsset?.ext === "string" ? rawAsset.ext : undefined,
        name,
        type,
    );
    return {
        id,
        type,
        name,
        source,
        ext,
        hash: typeof rawAsset?.hash === "string" && rawAsset.hash ? rawAsset.hash : undefined,
    };
}

function normalizeExtension(rawExt: string | undefined, name: string, type: string): string {
    const candidate = rawExt?.trim() || path.extname(name).replace(".", "");
    const safe = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (safe) {
        return safe.slice(0, 16);
    }
    if (type === "json" || type === "blueprint") {
        return "json";
    }
    return "bin";
}

async function readProjectConfig(projectPath: string): Promise<ProjectConfigData | null> {
    return readProjectConfigFromDir(projectPath);
}

/**
 * The page this build ends on, resolved for the variant it is being compiled as.
 *
 * Per variant for the reason the addresses are: the demo's ending is not the full game's, and the
 * same story document produces both. An absent tag is the release variant, which reads the project's
 * own choice. A blank answer is a build that shows nothing when its story ends, which is what every
 * build did before this existed.
 *
 * A document that will not parse propagates, exactly as it does above: a build whose variant record
 * could not be read has no business guessing at which page it ends on.
 */
async function readEndingSurfaceId(projectPath: string, appTagId: string | undefined): Promise<string> {
    const document = await readProjectAppTagDocumentFromDir(projectPath);
    const tag = resolveAppTag(document.tags, appTagId);
    return resolveAppTagEndingSurface(tag, document.endingSurfaceId).value;
}

/**
 * The key every edition of this title carries, whichever variant is being built.
 *
 * The mirror image of {@link readEndingSurfaceId}: that one resolves for the variant, because a
 * demo ends elsewhere. This one resolves for
 * the RELEASE tag on purpose, because the file it names is the one thing the variants have to
 * share - a demo that overrode `identifier` writes its saves where the release build cannot read
 * them, and the whole feature is the channel that survives that.
 *
 * No app-tag document is read, unlike its neighbour. The release tag is synthesized and carries
 * no overrides by construction (see `RELEASE_APP_TAG`), so the project's own identity IS the release
 * identity; going to disk for it would be a read whose answer is fixed. `resolveAppTagIdentity` is
 * still what performs it, inside `gameProgressKey`, so the rule lives in one place.
 *
 * The project directory's name backs a project that has neither an identifier nor a name, which is
 * the same fallback `pack.project.name` takes a few lines above.
 */
function readProgressKey(projectConfig: ProjectConfigData | null, projectPath: string): string {
    const base: AppTagBaseIdentity = {
        displayName: projectConfig?.name?.trim() || path.basename(projectPath) || "",
        identifier: projectConfig?.identifier?.trim() ?? "",
        version: readString(projectConfig?.metadata?.version) ?? "",
    };
    return gameProgressKey(base);
}

/**
 * The two records a plugin's declared fields are resolved against: the variant being compiled, and
 * the project's own values that every variant inherits.
 *
 * The pair travels rather than a finished answer, because the answer is per plugin and the plugins
 * are not known here - a field belongs to whichever plugin declared it, and only the copy pass
 * knows which plugins this pack ships. Resolution itself is `resolveShippedPluginBuildConfig`.
 *
 * A document that will not parse propagates, as it does for the addresses and the ending page: a
 * build that could not read its variant record has no business guessing what the author typed.
 */
async function readPluginConfigSource(
    projectPath: string,
    appTagId: string | undefined,
): Promise<{ tag: ProjectAppTag; base: AppTagPluginConfig }> {
    const document = await readProjectAppTagDocumentFromDir(projectPath);
    return {
        tag: resolveAppTag(document.tags, appTagId),
        base: document.pluginConfig ?? {},
    };
}

async function readOptionalJson<T>(filePath: string): Promise<T | null> {
    try {
        return await readJson<T>(filePath);
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

async function readJson<T>(filePath: string): Promise<T> {
    const raw = await fs.readFile(filePath, "utf-8");
    try {
        return JSON.parse(raw) as T;
    } catch (error) {
        throw new Error(`Invalid JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * The allowlist half of the pack's network block: what the author wrote, plus what each plugin in
 * this build declared and the author approved at install.
 *
 * The two are kept apart in the pack rather than merged here, because they are removed by different
 * acts - editing the project, uninstalling the plugin - and a surface reading the pack back has to
 * be able to say which is which.
 *
 * Read off the plugins that were actually copied into this app dir, not off the install registry: a
 * plugin excluded from this variant declares nothing about this artifact.
 *
 * Absent entirely when the project states the wide policy, which is what keeps a project that never
 * narrowed anything byte-identical to one built before a list could be stated.
 */
function resolvePackNetworkAllowlist(
    projectConfig: ProjectConfigData | null,
    packPlugins: readonly GameRuntimePackPluginEntry[],
): Pick<GameRuntimeNetworkConfig, "policy" | "allowlist" | "pluginAllowlist"> {
    const network = (projectConfig?.app as { network?: { policy?: unknown; allowlist?: unknown } } | undefined)?.network;
    if (network?.policy !== NETWORK_POLICY_ALLOWLIST) {
        return {};
    }
    const pluginAllowlist: NetworkPluginAllowlistEntry[] = [];
    for (const plugin of packPlugins) {
        const patterns = plugin.manifest.contributes?.network ?? [];
        if (patterns.length > 0) {
            pluginAllowlist.push({ pluginId: plugin.manifest.id, patterns: [...patterns] });
        }
    }
    return {
        policy: NETWORK_POLICY_ALLOWLIST,
        allowlist: normalizeNetworkAllowlistEntries(network.allowlist),
        ...(pluginAllowlist.length > 0 ? { pluginAllowlist } : {}),
    };
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    try {
        return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    } catch {
        return undefined;
    }
}
