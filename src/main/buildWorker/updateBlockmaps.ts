import path from "path";

/**
 * electron-builder's update block maps, left out of a game's packaging.
 *
 * After it writes an NSIS installer - and a macOS zip - electron-builder reads the whole file back to
 * cut it into content-defined blocks and hash each one, and writes the result beside it as
 * `<file>.blockmap`. That file is for electron-updater: it is how an installed app downloads only the
 * blocks of a new version that changed. A game Studio builds does not update through electron-updater
 * (its configuration has no `publish` at all), so nothing ever reads it - and the pass is plain
 * JavaScript on one core, 20 seconds for a 460 MB installer and over a minute for a 1.6 GB one.
 *
 * There is no switch for it. `differentialPackage: false` stops it, but the same option is what keeps
 * the installer's payload a non-solid 7z with a small dictionary, and without it 7-Zip compresses the
 * payload as one solid stream: measured on the same project, 126 seconds instead of 9 to save 7 MB.
 * So the step itself is replaced, for as long as one packaging run lasts, with one that answers that
 * there is no update information - which is what a target that never writes any answers anyway.
 *
 * The seam is electron-builder's own module export, which both of its callers (the NSIS target and
 * the archive target) look up at the moment they call it. `updateBlockmaps.test.ts` reads both
 * callers' source and fails if a release of electron-builder stops calling it that way, so an
 * upgrade that would quietly bring the pass back is caught there instead.
 */

export type BlockmapModule = {
    createBlockmap: (...args: never[]) => Promise<unknown>;
};

/**
 * The module electron-builder calls, resolved from electron-builder's own location: a copy found any
 * other way could be a different file, and replacing its export would change nothing.
 */
export function blockmapModulePath(): string {
    return require.resolve("app-builder-lib/out/targets/differentialUpdateInfoBuilder", {
        paths: [path.dirname(require.resolve("electron-builder"))],
    });
}

function loadBlockmapModule(): BlockmapModule {
    return require(blockmapModulePath()) as BlockmapModule;
}

export async function withoutUpdateBlockmaps<T>(
    body: () => Promise<T>,
    target: BlockmapModule = loadBlockmapModule(),
): Promise<T> {
    const original = target.createBlockmap;
    target.createBlockmap = async () => null;
    try {
        return await body();
    } finally {
        target.createBlockmap = original;
    }
}
