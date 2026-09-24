import { createRequire } from "module";
import { unpackAsarPath } from "@shared/utils/asarPath";

type EsbuildModule = typeof import("esbuild");

/** The two things the loader needs from Node's `require`, so a test can stand in for both. */
export type EsbuildRequire = {
    (id: "esbuild"): unknown;
    resolve(specifier: string): string;
};

/**
 * esbuild's JavaScript API, loaded so that it can start its own binary wherever Studio runs.
 *
 * Every load of esbuild on Studio's main side goes through here: the author's scripts are compiled
 * with it in Dev Mode and in every build, and the Live2D runtime installer bundles the author's
 * Cubism SDK with it.
 *
 * # Why not a plain `import("esbuild")`
 *
 * The API runs a platform binary that it locates with `require.resolve`, and in a packaged Studio
 * that answer is a path inside `app.asar`. The file is on disk - asarUnpack puts all of node_modules
 * under `app.asar.unpacked` - but esbuild starts it with `child_process.spawn`, which Electron does
 * not redirect out of the archive, so the spawn fails with ENOENT. An unpacked checkout never sees
 * this, which is how every script compile in a packaged Studio could fail while every test and every
 * `yarn dev` session passed.
 *
 * esbuild reads `ESBUILD_BINARY_PATH` once, when its module is first evaluated. So the unpacked path
 * is put there for exactly that evaluation and removed again. Left in the environment it would reach
 * every process Studio starts afterwards - the author's own editor among them - where a different
 * esbuild would find a binary of another version and refuse it.
 *
 * Because the first evaluation is the one that counts, a second load that bypassed this function
 * and ran first would decide the answer for the whole process. `esbuildLoader.test.ts` keeps this
 * the only place under `src/main` that loads the package.
 */
export async function loadEsbuild(): Promise<EsbuildModule> {
    return loadEsbuildWith(createRequire(__filename) as unknown as EsbuildRequire);
}

/** {@link loadEsbuild}, with the `require` it loads through. */
export function loadEsbuildWith(requireFn: EsbuildRequire): EsbuildModule {
    const binary = unpackedEsbuildBinary(specifier => requireFn.resolve(specifier));
    // A path the author or the machine configured is theirs, and one that is not inside an archive
    // needs no help.
    if (!binary || process.env.ESBUILD_BINARY_PATH) {
        return requireFn("esbuild") as EsbuildModule;
    }
    process.env.ESBUILD_BINARY_PATH = binary;
    try {
        return requireFn("esbuild") as EsbuildModule;
    } finally {
        delete process.env.ESBUILD_BINARY_PATH;
    }
}

/**
 * The on-disk copy of esbuild's platform binary when the package resolves inside an asar archive,
 * or null when it does not - an unpacked checkout, or a platform esbuild publishes no binary for, in
 * which case esbuild's own resolution runs and its own message says what is missing.
 *
 * The package name follows esbuild's `@esbuild/<platform>-<arch>` scheme, which holds for every host
 * Studio ships on.
 */
export function unpackedEsbuildBinary(resolve: (specifier: string) => string): string | null {
    const executable = process.platform === "win32" ? "esbuild.exe" : "bin/esbuild";
    let resolved: string;
    try {
        resolved = resolve(`@esbuild/${process.platform}-${process.arch}/${executable}`);
    } catch {
        return null;
    }
    const onDisk = unpackAsarPath(resolved);
    return onDisk === resolved ? null : onDisk;
}
