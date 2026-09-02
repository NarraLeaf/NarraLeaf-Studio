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

import path from "path";
import type { BlueprintDocument, BlueprintDiagnostic } from "@shared/types/blueprint/document";
import { isScriptSourcePath } from "@shared/project/scriptsDirectory";

type EsbuildModule = typeof import("esbuild");

/** One compiled script, as the bundle carries it. */
export type CompiledScriptModule = {
    /** The file it came from, for a message that names something the author can open. */
    scriptRef: string;
    /** ESM text, ready to be imported. Absent when the compile failed. */
    code?: string;
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
    // Injected so a test can compile without resolving the real bundler, matching how the puppet
    // runtime build takes it.
    loadEsbuild: () => Promise<EsbuildModule> = () => import("esbuild"),
): Promise<CompiledScripts> {
    const refs = collectScriptRefs(document);
    if (refs.size === 0) {
        return {};
    }

    const esbuild = await loadEsbuild();
    const byRef = new Map<string, CompiledScriptModule>();

    for (const scriptRef of new Set(refs.values())) {
        byRef.set(scriptRef, await compileOne(esbuild, projectPath, scriptRef));
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
        return { scriptRef, code };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failure(scriptRef, `${scriptRef} could not be compiled: ${message}`);
    }
}
