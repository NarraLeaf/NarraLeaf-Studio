/**
 * How one of the five TypeScript projects is type-checked: the node arguments for it, shared by
 * scripts/typecheck.mjs (`yarn lint`) and scripts/verify.mjs (`yarn verify`, CI) so the two cannot
 * check with different compilers.
 *
 * The checker is tsrs, a Rust port of the TypeScript 7 compiler, pinned to an exact version in
 * package.json. Measured on an 8 GB M1 against the 5.x tsc it replaced, from cold: the renderer
 * project in 3-5s and 0.5-0.9 GB, against 61s and 3.3 GB, and 6,700 swap-ins against 1.07 million.
 * The five projects report nothing under either. On deliberately broken code it reported every
 * planted error, and where both compilers were run, the same errors at the same positions as tsc 5.9.
 *
 * NLS_TYPECHECKER=tsc goes back to this checkout's node_modules/typescript for a run, for when tsrs
 * reports something tsc does not, or the other way round. TypeScript 5.x stays installed anyway:
 * the plugin API declarations and the script API generator use its compiler API.
 *
 * Each compiler keeps its incremental cache in a directory of its own, .cache/tsrs and .cache/tsc,
 * overriding `tsBuildInfoFile` in the project's tsconfig. Their build info formats differ, so one
 * file shared between them would be thrown away by whichever ran second.
 */
import fs from "node:fs";
import path from "node:path";

export const PROJECTS = ["shared", "main", "renderer", "runtime", "builtin-plugins"];

const COMPILERS = {
    tsrs: "node_modules/tsrs/bin/tsrs",
    tsc: "node_modules/typescript/bin/tsc",
};

/**
 * Heap for tsc only. The renderer-sized programs outgrow node's default on a machine with little
 * memory and die with "Reached heap limit" after a minute or more, which looks like a hang. tsrs is
 * a native binary started through a small node launcher, so a heap flag would mean nothing to it.
 */
const TSC_HEAP_MB = 6144;

/** Which compiler this run uses: tsrs unless NLS_TYPECHECKER says tsc. */
export function typecheckCompiler() {
    const asked = process.env.NLS_TYPECHECKER?.trim();
    if (!asked) {
        return "tsrs";
    }
    if (!(asked in COMPILERS)) {
        throw new Error(`NLS_TYPECHECKER=${asked}; expected ${Object.keys(COMPILERS).join(" or ")}`);
    }
    return asked;
}

/** The compiler's entry point relative to the checkout, or null when it is not installed. */
export function typecheckEntry(root, compiler = typecheckCompiler()) {
    const entry = COMPILERS[compiler];
    return fs.existsSync(path.join(root, entry)) ? entry : null;
}

/**
 * Arguments to `node` that type-check one project from the checkout root.
 *
 * `fast` is a local feedback loop and never the gate. Under tsrs it is the compiler's own `--fast`
 * preset, which sizes the checker count to the machine and adds caches, and which its authors say
 * may differ from the pinned TypeScript; under tsc it is --assumeChangesOnlyAffectDirectDependencies,
 * which stops invalidation at the direct importers of a changed file, so an error reached only
 * through an indirect importer waits for the next full run. Either way it keeps a cache file of its
 * own, since the options a run used are recorded in the build info and a mismatch discards it.
 */
export function typecheckArgs(project, { compiler = typecheckCompiler(), fast = false } = {}) {
    const cache = `.cache/${compiler}/${project}${fast ? ".fast" : ""}.tsbuildinfo`;
    const common = ["--project", `src/${project}/tsconfig.json`, "--tsBuildInfoFile", cache];
    if (compiler === "tsc") {
        return [
            `--max-old-space-size=${TSC_HEAP_MB}`,
            COMPILERS.tsc,
            ...common,
            ...(fast ? ["--assumeChangesOnlyAffectDirectDependencies"] : []),
        ];
    }
    return [COMPILERS.tsrs, ...common, ...(fast ? ["--fast"] : [])];
}
