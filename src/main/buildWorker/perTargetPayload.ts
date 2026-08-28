/**
 * Where a build stages the parts of a game that cannot be the same in every
 * package it produces.
 *
 * One compiled app directory serves every desktop target in a build - it holds
 * the story, the assets, the runtime bundle, all of which are the same wherever
 * the game runs. Three things in it are not: the content codec addon, koffi's
 * addon, and any executable a plugin contributes as a sidecar are machine code
 * for one platform and architecture, and a package carrying another one's is a
 * package that fails on first run.
 *
 * They are staged under `platform/<platform>-<arch>/` instead of at the app
 * root, and the packaging step maps the directory belonging to the target it is
 * producing over the root - so each package ends up with exactly its own copies,
 * at the paths the game already looks for them at, and none of the others.
 * electron-builder is invoked once per target and takes a file set per
 * invocation, so this costs nothing beyond naming the directory: see
 * `perTargetFileSets` and its caller in runGameBuild.ts.
 *
 * The alternative that was there before was to ship these only when a build
 * produced exactly one desktop target, and to say so and ship none otherwise.
 * That made a two-platform build quietly weaker than two one-platform builds,
 * which is the wrong way round - the author asking for both is the one shipping
 * to more players.
 */

/** The directory under the app root that holds one subdirectory per target. */
export const PER_TARGET_DIR_NAME = "platform";

/**
 * The `files` entries that resolve one target's staged payload onto the app root.
 *
 * Two halves, and both are needed. The string patterns steer electron-builder's
 * default matcher, which is what copies the app: everything, minus the staging
 * area. The object is a second matcher rooted at this target's directory and
 * writing to the app root, which is how the copies for this machine arrive at
 * the names the game opens them by.
 *
 * A build for a target with nothing staged is fine; a matcher whose source
 * directory does not exist contributes no files.
 */
export function perTargetFileSets(platformKey: string): (string | { from: string; to: string; filter: string[] })[] {
    return [
        "**/*",
        `!${PER_TARGET_DIR_NAME}/**`,
        { from: `${PER_TARGET_DIR_NAME}/${platformKey}`, to: ".", filter: ["**/*"] },
    ];
}

/**
 * The asar-unpack pattern covering the staging area.
 *
 * Everything staged per target is there because it is opened by the OS loader
 * rather than by Electron's fs, which is the same reason the app root copies are
 * unpacked. The patterns are matched against the path a file is read FROM, not
 * the path it is written to, so the app-root spellings do not cover these and
 * this has to be listed as well.
 */
export function perTargetUnpackPattern(): string {
    return `${PER_TARGET_DIR_NAME}/**`;
}
