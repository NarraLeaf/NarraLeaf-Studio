/**
 * Compiling the author's script blueprints into modules a running game can import.
 *
 * A script blueprint names a file under `<project>/scripts/`. This bundles each named file with
 * esbuild and hands back the module text, which the bundle carries to whichever runtime is going to
 * run it. Nothing here executes the author's code - esbuild reads bytes, it does not run them - so
 * the boundary that says the build runs no third-party code is intact, and it is the reason Studio
 * never runs a package manager either: an install would run its dependencies' postinstall scripts.
 * The author runs `npm install` themselves, and what is already on disk is what gets bundled.
 *
 * # A compile failure is a diagnostic, never a refused build
 *
 * The load-bearing rule of this whole feature is that **a build never depends on a type check**.
 * esbuild strips types without reading them, so a script whose types are wrong still compiles and
 * still runs; only a syntax error or an unresolvable import can fail here. When one does, the
 * blueprint is reported and skipped, and the rest of the game builds and runs - the author gets a
 * game with one dead handler and a message naming the file, not a project that will not open.
 */

import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import type { BlueprintDocument, BlueprintDiagnostic } from "@shared/types/blueprint/document";
import { isScriptSourcePath } from "@shared/project/scriptsDirectory";

type EsbuildModule = typeof import("esbuild");

/**
 * One compiled script, as the bundle carries it.
 *
 * A **URL rather than the text**, and that is not a preference. Every host that runs a game has a
 * Content-Security-Policy, and none of them admits a script from a `blob:` or a `data:` URL - the
 * shipped runtime's `script-src` is `'self' <scheme>: 'nonce-…'` and does not even carry
 * `unsafe-eval`. What both hosts do admit is a URL they serve: a file for Dev Mode, whose policy
 * allows `file:`, and the pack's own scheme for a packaged game. So a compiled script is written to
 * disk and named, exactly as a plugin's entry is.
 */
export type CompiledScriptModule = {
    /** The file it came from, for a message that names something the author can open. */
    scriptRef: string;
    /** Where the compiled module was written, as a URL the host can import. Absent when it failed. */
    url?: string;
    diagnostics?: BlueprintDiagnostic[];
};

/** Compiled scripts by blueprint id. Two blueprints naming one file each get their own entry. */
export type CompiledScripts = Record<string, CompiledScriptModule>;

/** The script each script blueprint names, by blueprint id. */
export function collectScriptRefs(document: BlueprintDocument | undefined): Map<string, string> {
    const refs = new Map<string, string>();
    for (const [blueprintId, blueprint] of Object.entries(document?.blueprints ?? {})) {
        if (blueprint?.program?.kind === "scriptModule") {
            refs.set(blueprintId, blueprint.program.scriptRef);
        }
    }
    return refs;
}

function failure(scriptRef: string, message: string): CompiledScriptModule {
    return {
        scriptRef,
        diagnostics: [{ severity: "error", message, code: "script.compile", location: { scriptRef } }],
    };
}

/**
 * Bundle every script the document names.
 *
 * Compiled once per distinct file rather than once per blueprint: two blueprints pointing at one
 * script are the same module, and bundling it twice would give them separate copies of its
 * module-level state, which is not what an author reading one file would expect.
 */
export async function compileProjectScripts(
    projectPath: string,
    document: BlueprintDocument | undefined,
    /**
     * Where the compiled modules are written, and how they are named to the host that imports them.
     *
     * Dev Mode writes into the project's own `.nlstudio/` - which version control and an export both
     * exclude - and names them as `file:` URLs, which its policy admits. A packaged build writes
     * them into the pack and names them by the pack's scheme.
     */
    output?: { directory: string; toUrl?: (filePath: string) => string },
    // Injected so a test can compile without resolving the real bundler, matching how the puppet
    // runtime build takes it.
    loadEsbuild: () => Promise<EsbuildModule> = () => import("esbuild"),
): Promise<CompiledScripts> {
    const refs = collectScriptRefs(document);
    if (refs.size === 0) {
        return {};
    }

    if (!output) {
        // Nowhere to put them, so nothing can be imported. Said once rather than per script.
        return Object.fromEntries(
            [...refs].map(([blueprintId, scriptRef]) => [
                blueprintId,
                failure(scriptRef, "This host cannot serve compiled scripts."),
            ]),
        );
    }

    const esbuild = await loadEsbuild();
    await fs.mkdir(output.directory, { recursive: true });
    const toUrl = output.toUrl ?? (filePath => pathToFileURL(filePath).toString());
    const byRef = new Map<string, CompiledScriptModule>();

    for (const scriptRef of new Set(refs.values())) {
        byRef.set(scriptRef, await compileOne(esbuild, projectPath, scriptRef, output.directory, toUrl));
    }

    const out: CompiledScripts = {};
    for (const [blueprintId, scriptRef] of refs) {
        out[blueprintId] = byRef.get(scriptRef) as CompiledScriptModule;
    }
    return out;
}

async function compileOne(
    esbuild: EsbuildModule,
    projectPath: string,
    scriptRef: string,
    outputDirectory: string,
    toUrl: (filePath: string) => string,
): Promise<CompiledScriptModule> {
    // The document is the author's and its paths are theirs to write, so a path that is not a
    // script in this project is refused here rather than handed to a bundler with a project root.
    if (!isScriptSourcePath(scriptRef)) {
        return failure(scriptRef, `"${scriptRef}" is not a script in this project.`);
    }
    const entry = path.join(projectPath, ...scriptRef.split("/"));

    try {
        const result = await esbuild.build({
            entryPoints: [entry],
            bundle: true,
            write: false,
            format: "esm",
            platform: "browser",
            target: "es2022",
            // The author's dependencies are bundled in, which is what their own `npm install` is
            // for. Nothing is external: a game has no module resolver at runtime.
            //
            // `@narraleaf/script` is never resolved because it is only ever imported with
            // `import type`, which is erased before this runs. A value import of it reaches here as
            // an unresolvable path and is reported - which is the right answer, since there is no
            // runtime module behind that name.
            logLevel: "silent",
            sourcemap: "inline",
            absWorkingDir: projectPath,
        });
        const code = result.outputFiles?.[0]?.text;
        if (typeof code !== "string") {
            return failure(scriptRef, `${scriptRef} produced no output.`);
        }
        // Named after the source rather than after a blueprint id, so a stack trace in the game's
        // console names something the author can open. Two blueprints on one file share it.
        const outputName = `${scriptRef.replace(/[\/]/g, "_").replace(/\.(ts|js)$/, "")}.mjs`;
        const outputPath = path.join(outputDirectory, outputName);
        await fs.writeFile(outputPath, code, "utf-8");
        return { scriptRef, url: toUrl(outputPath) };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failure(scriptRef, `${scriptRef} could not be compiled: ${message}`);
    }
}
