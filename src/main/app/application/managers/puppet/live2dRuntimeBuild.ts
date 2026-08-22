/**
 * Building the Live2D puppet backend on the author's machine.
 *
 * This exists because no one else can do it. The Cubism Framework ships as TypeScript source and only
 * the Core is redistributable, so a prebuilt Live2D adapter cannot legally be published — not by
 * NarraLeaf, not by anyone. The author is the only party who may hold the SDK and the produced module
 * at the same time, which makes "Studio compiles it here, from the archive you downloaded" the only
 * route that ends with a working Live2D character.
 *
 * Two properties of the as-shipped SDK make it unusable as a browser module, and the two generated
 * files below exist only to work around them: {@link coreModule} republishes the Core's global, and
 * {@link shaderModule} inlines the shader sources the WebGL renderer would otherwise `fetch()`. Both
 * failure modes are silent — a wrong result draws nothing rather than raising — so neither step is
 * optional.
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
 * The head of the produced file: the Core verbatim, then the notices a bundler would otherwise drop.
 *
 * The Core travels as the bundler's banner rather than through the bundler because it is the one part
 * of an SDK archive that may not be altered. The Proprietary Software License Agreement grants the
 * right to copy and redistribute the Redistributable Code (5.1) but not to modify it (6.1), and
 * requires it to be redistributed "on an as is basis when Live2D provides it" (5.2.4) — where the
 * Framework's own licence expressly grants the right to alter it (Open Software License 2.1). A banner
 * is inserted as text, so `live2dcubismcore.min.js` reaches the author's game byte for byte and its
 * copyright header arrives with it.
 *
 * The line after it is NarraLeaf's, and is what makes the file work at all: the Core is a classic
 * script declaring `var Live2DCubismCore` at what it assumes is global scope, and inside a module that
 * `var` is module-scoped. Every Framework module reads the bare global and never an import, so without
 * the publish they all fail at the first call with no diagnostic that points here.
 */
function coreBanner(coreSource: string, frameworkNotice: string): string {
    return `${coreSource}
globalThis.Live2DCubismCore = Live2DCubismCore;
// The Cubism Framework sources bundled below carry this header:
${frameworkNotice}
`;
}

/** What NarraLeaf writes when the Framework's own header cannot be read. */
const FRAMEWORK_NOTICE_FALLBACK = `/*!
 * Cubism Framework, (C) Live2D Inc. All rights reserved.
 * Live2D Open Software License:
 * https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html
 */`;

/**
 * The Framework's copyright header, lifted from one of its sources.
 *
 * A bundler drops it otherwise, and a build stripped of it is one the author is not allowed to
 * distribute (Open Software License 5.1 and 5.7). esbuild keeps a comment only when it contains
 * `@license` or `@preserve` or opens with `//!` or `/*!`, and every Framework source opens with a
 * plain block comment, so `legalComments` never sees one. All of them carry the same header, which is
 * why one copy is the whole of it.
 */
function frameworkNotice(source: string | null): string | null {
    const header = source ? /^\s*\/\*\*[\s\S]*?\*\//.exec(source) : null;
    return header ? header[0].trim() : null;
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

The licence covers redistributing them inside that game, and not a public source repository. Keep this
directory out of any repository you publish.

## Rebuilding

Delete this directory and install the runtime again from Studio, using the same or a newer SDK archive.
Nothing else in your project refers to the contents of this file, only to the \`live2d\` backend name.

Do not edit \`${PUPPET_RUNTIME_ENTRY_FILE}\` by hand; the next install overwrites it.
`;
}

type EsbuildModule = typeof import("esbuild");

/**
 * A Node specifier that reaches the bundler fails the build rather than warning, so any source naming
 * one is pointed at an empty CommonJS module. Written for the Core's emscripten glue, which keeps a
 * Node file-reading branch guarded by checks a browser never passes; the Core no longer goes through
 * the bundler, and this stays for the Framework, which ships as source and is the author's.
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
 *     <staging>/glue/gen/shaders.js generated; see shaderModule
 *
 * The Core is not part of that tree. It is prepended to the output instead; see {@link coreBanner}.
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

    // The first source doubles as the copyright header every one of them carries; see frameworkNotice.
    let frameworkHeaderSource: string | null = null;
    for (const [relative, entry] of found.framework) {
        const bytes = readArchiveEntry(archive, entry);
        frameworkHeaderSource ??= bytes.toString("utf-8");
        await writeFileEnsuringDir(path.join(staging, "sdk", "framework", ...relative.split("/")), bytes);
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
    await writeFileEnsuringDir(path.join(staging, "glue", "gen", "shaders.js"), shaderModule(shaderSources));

    const notice = frameworkNotice(frameworkHeaderSource);
    if (!notice) {
        log("warning", "the Framework sources carry no copyright header; a NarraLeaf-written one is used instead");
    }
    const banner = coreBanner(
        readArchiveEntry(archive, found.core).toString("utf-8"),
        notice ?? FRAMEWORK_NOTICE_FALLBACK,
    );

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
        banner: { js: banner },
        // For anything in the archive that marks a header as a legal comment. Live2D's own headers do
        // not, which is why the notices in the banner are placed by hand.
        legalComments: "inline",
        plugins: [stubNodeBuiltins as never],
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
