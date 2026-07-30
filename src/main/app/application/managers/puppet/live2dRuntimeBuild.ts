/**
 * Building the Live2D puppet backend on the author's machine.
 *
 * This exists because no one else can do it. The Cubism Framework ships as TypeScript source and only
 * the Core is redistributable, so a prebuilt Live2D adapter cannot legally be published — not by
 * NarraLeaf, not by anyone. The author is the only party who may hold the SDK and the produced module
 * at the same time, which makes "Studio compiles it here, from the archive you downloaded" the only
 * route that ends with a working Live2D character. See `docs/plans/2026-07-27-002`.
 *
 * The recipe is not invented here; it is the one that was brought up by hand and verified end to end
 * against a real model, and the two generated files below are the two things that make an as-shipped
 * SDK unusable in a browser module. Deviating from it means rediscovering both.
 *
 * Deliberately electron-free — `userDataDir` and `glueDir` are passed in — so the whole build can be
 * exercised from a test.
 */

import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import { PUPPET_RUNTIME_ENTRY_FILE } from "@shared/utils/puppetRuntimes";
import { inspectLive2DSdkArchive, readArchiveEntry, type Live2DSdkArchive } from "./live2dSdkArchive";

export type PuppetRuntimeBuildLog = (level: "info" | "warning" | "error", message: string) => void;

const CACHE_DIR_NAME = "cache";
const CACHE_BUCKET_NAME = "puppet-runtimes";
const LICENSE_DIR_NAME = "licenses";

export type Live2DRuntimeBuildRequest = {
    /** The archive the author picked. Read once; never written to. */
    archivePath: string;
    /** `<project>/runtimes/puppet/live2d`. Created if absent; `index.js` inside it is replaced. */
    targetDir: string;
    /** Electron's userData directory. Only used to place the staging cache. */
    userDataDir: string;
    /** Studio's shipped glue directory — `resources/puppet-glue/live2d`. */
    glueDir: string;
    log?: PuppetRuntimeBuildLog;
};

export type Live2DRuntimeBuildResult = {
    backend: "live2d";
    /** As the archive stated it, for the author and for the README beside the build. */
    sdkVersion: string | null;
    entryPath: string;
    bytes: number;
    /** What went into it, for the same reason. */
    frameworkFiles: number;
    shaderFiles: number;
};

/**
 * Staging root for one archive, keyed by its content digest.
 *
 * The digest rather than the path, exactly as `pluginBuildDependencies` does it: re-picking the same
 * download twice does the unpacking once, and an author who re-downloads a *different* build gets a
 * different directory rather than a half-updated one.
 */
export function live2dStagingDir(userDataDir: string, archiveSha256: string): string {
    return path.join(userDataDir, CACHE_DIR_NAME, CACHE_BUCKET_NAME, "live2d", archiveSha256);
}

async function writeFileEnsuringDir(target: string, data: string | Buffer): Promise<void> {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
}

/**
 * Re-emit the Core so a bundler can consume it.
 *
 * The Core is a classic script: it declares `var Live2DCubismCore` at file top level and relies on that
 * becoming a property of `window`. Bundled as a module that `var` stays module-scoped, and the
 * Framework — which reads the bare global, never an import — sees nothing and fails at the first call
 * with no diagnostic that points here. The explicit publish is the fix.
 */
function coreModule(coreSource: string): string {
    return `${coreSource}
// Published deliberately: every Framework module reads the bare global, never an import.
globalThis.Live2DCubismCore = Live2DCubismCore;
export default Live2DCubismCore;
`;
}

/**
 * Inline the shader sources.
 *
 * Since 5-r.5 the WebGL renderer no longer carries its shaders: `loadShaders()` builds `<dir><basename>`
 * and `fetch()`es 13 files at first draw, swallowing failures into an empty string — so a wrong path
 * does not error, it compiles empty programs and draws nothing. A backend module is served from a
 * single-use opaque grant URL with no directory space behind it, so there is no path to point it at.
 * The glue intercepts the one-line fetch and reads this table; the basename is all the URL carries that
 * matters.
 */
function shaderModule(sources: ReadonlyMap<string, string>): string {
    const entries = [...sources.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([name, source]) => `    ${JSON.stringify(name)}: ${JSON.stringify(source)},`);
    return `// Generated from the author's Cubism SDK. Keyed by basename, which is all the loader's URL
// carries that matters.
export const SHADER_SOURCES = {
${entries.join("\n")}
};
`;
}

/**
 * What the author gets beside the module, so the directory explains itself.
 *
 * The build is ~1 MB of someone else's licensed code sitting in the author's project, and it will end
 * up in their version control and their shipped game. A directory that cannot say what it is or where
 * it came from is how that becomes a licensing problem later.
 */
function readmeText(result: Omit<Live2DRuntimeBuildResult, "entryPath" | "bytes">): string {
    return `# Live2D puppet runtime

\`${PUPPET_RUNTIME_ENTRY_FILE}\` is a **generated** file. NarraLeaf Studio built it on this machine by
bundling its own adapter code together with the Cubism SDK for Web that you supplied.

- Cubism SDK version: ${result.sdkVersion ?? "(not stated by the archive)"}
- Framework sources compiled in: ${result.frameworkFiles}
- Shader sources inlined: ${result.shaderFiles}

## Licensing

This file contains Live2D Cubism Core and the Cubism Framework, which are (C) Live2D Inc. and are
covered by the Live2D Proprietary Software License Agreement and the Live2D Open Software License
respectively. The licence texts as they shipped in your SDK archive are in \`${LICENSE_DIR_NAME}/\`.

You are the party distributing them, in the game you build from this project — NarraLeaf does not
redistribute the SDK and never downloads it. Your obligations to Live2D (including the publication
licence and its revenue threshold) are yours, and they apply to the game you ship.

## Rebuilding

Delete this directory and install the runtime again from Studio, using the same or a newer SDK archive.
Nothing else in your project refers to the contents of this file, only to the \`live2d\` backend name.

Do not edit \`${PUPPET_RUNTIME_ENTRY_FILE}\` by hand; the next install overwrites it.
`;
}

type EsbuildModule = typeof import("esbuild");

/**
 * The Core's emscripten glue keeps its Node file-reading branch, guarded at runtime by checks a browser
 * never passes. The bundler still has to *resolve* those specifiers, so they are pointed at an empty
 * CommonJS module: dead code that resolves, rather than a build failure.
 */
const stubNodeBuiltins = {
    name: "stub-node-builtins",
    setup(build: { onResolve: Function; onLoad: Function }) {
        build.onResolve({ filter: /^(fs|path|crypto)$/ }, (args: { path: string }) => ({
            path: args.path,
            namespace: "node-stub",
        }));
        build.onLoad({ filter: /.*/, namespace: "node-stub" }, () => ({
            contents: "module.exports = {};",
            loader: "js",
        }));
    },
};

/**
 * Unpack, generate, bundle, and file the result.
 *
 * The staging layout is what lets Studio's shipped glue be used *verbatim* — its import specifiers
 * (`../sdk/framework/…`, `./gen/…`) are written against exactly this tree, so the file that was verified
 * by hand is the file that gets compiled:
 *
 *     <staging>/sdk/framework/**    the author's Framework sources, as TypeScript
 *     <staging>/glue/index.js       Studio's adapter, copied
 *     <staging>/glue/gen/core.js    generated; see coreModule
 *     <staging>/glue/gen/shaders.js generated; see shaderModule
 */
export async function buildLive2DRuntime(
    request: Live2DRuntimeBuildRequest,
    // Injected so a test can build without resolving the real bundler, and so the packaged app's
    // require of it stays in one place.
    loadEsbuild: () => Promise<EsbuildModule> = () => import("esbuild"),
): Promise<Live2DRuntimeBuildResult> {
    const log = request.log ?? (() => undefined);

    const archive = await fs.readFile(request.archivePath);
    const digest = createHash("sha256").update(archive).digest("hex");
    log("info", `read ${path.basename(request.archivePath)} (${archive.length} bytes, sha256 ${digest.slice(0, 12)}…)`);

    const found: Live2DSdkArchive = inspectLive2DSdkArchive(archive);
    log("info", `Cubism SDK ${found.version ?? "(version not stated)"}: ${found.framework.size} framework sources, ${found.shaders.size} shaders`);

    const staging = live2dStagingDir(request.userDataDir, digest);
    // Rebuilt rather than reused: the produced module also depends on Studio's own glue, which changes
    // with Studio and not with the archive, so a cached tree keyed only by the archive would go stale.
    // Unpacking 20 MB takes well under a second and this runs once per install, by hand.
    await fs.rm(staging, { recursive: true, force: true });

    for (const [relative, entry] of found.framework) {
        await writeFileEnsuringDir(
            path.join(staging, "sdk", "framework", ...relative.split("/")),
            readArchiveEntry(archive, entry),
        );
    }

    const shaderSources = new Map<string, string>();
    for (const [name, entry] of found.shaders) {
        shaderSources.set(name, readArchiveEntry(archive, entry).toString("utf-8"));
    }

    const glueEntry = path.join(staging, "glue", PUPPET_RUNTIME_ENTRY_FILE);
    await writeFileEnsuringDir(
        glueEntry,
        await fs.readFile(path.join(request.glueDir, PUPPET_RUNTIME_ENTRY_FILE), "utf-8"),
    );
    await writeFileEnsuringDir(
        path.join(staging, "glue", "gen", "core.js"),
        coreModule(readArchiveEntry(archive, found.core).toString("utf-8")),
    );
    await writeFileEnsuringDir(path.join(staging, "glue", "gen", "shaders.js"), shaderModule(shaderSources));

    const esbuild = await loadEsbuild();
    const outfile = path.join(staging, "out", PUPPET_RUNTIME_ENTRY_FILE);
    log("info", "bundling the runtime…");
    await esbuild.build({
        entryPoints: [glueEntry],
        outfile,
        bundle: true,
        format: "esm",
        platform: "browser",
        target: "es2022",
        // The SDK's own licence headers travel into the output, which is where they belong: the file is
        // about to be shipped inside the author's game.
        legalComments: "inline",
        plugins: [stubNodeBuiltins as never],
        logOverride: {
            "direct-eval": "silent",
            // All inside the minified Core, and all correct as shipped.
            "suspicious-boolean-not": "silent",
            "commonjs-variable-in-esm": "silent",
        },
    });

    const bundle = await fs.readFile(outfile);
    const result: Live2DRuntimeBuildResult = {
        backend: "live2d",
        sdkVersion: found.version,
        entryPath: path.join(request.targetDir, PUPPET_RUNTIME_ENTRY_FILE),
        bytes: bundle.length,
        frameworkFiles: found.framework.size,
        shaderFiles: found.shaders.size,
    };

    // Written last, so a failed build never leaves a project holding half a runtime.
    await fs.mkdir(request.targetDir, { recursive: true });
    await fs.writeFile(result.entryPath, bundle);
    await fs.rm(path.join(request.targetDir, LICENSE_DIR_NAME), { recursive: true, force: true });
    for (const [relative, entry] of found.licenses) {
        await writeFileEnsuringDir(
            path.join(request.targetDir, LICENSE_DIR_NAME, ...relative.split("/")),
            readArchiveEntry(archive, entry),
        );
    }
    await fs.writeFile(path.join(request.targetDir, "README.md"), readmeText(result));

    log("info", `wrote ${result.entryPath} (${result.bytes} bytes)`);
    return result;
}
