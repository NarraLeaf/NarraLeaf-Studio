import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";

/**
 * What a finished run can be traced back to, as one console line.
 *
 * The pack states all of this and the pack ships inside the package - sealed, for a protected build -
 * so this line is the only copy of it the author can reach, and the archived build log is where it
 * is kept. Which is the whole point: a build ledger that records that a build happened, and nothing
 * about what went into it, tells an author the answer exists somewhere when it does not.
 *
 * A project with no version control is told so in the same sentence rather than having the clause
 * quietly left out. The difference between "there is no revision" and "there was one and this line
 * does not mention it" is the difference between knowing where to look and thinking you have looked.
 */
export function describeBuildProvenance(pack: Pick<GameRuntimePackV1,
    "runtimeVersion" | "engineVersion" | "projectRevision">): string {
    const revision = pack.projectRevision
        // Truncated the way the checkpoint line truncates: enough to identify the revision in a
        // history, and the pack keeps the whole id for anything that has to match on it.
        ? `project revision #${pack.projectRevision.number} (${pack.projectRevision.id.slice(0, 12)})`
        : "no project revision: this project is not under version control";
    return `built with Studio ${pack.runtimeVersion}`
        + `${pack.engineVersion ? `, engine ${pack.engineVersion}` : ""}; ${revision}`;
}

/**
 * Whether a patch and the build it installs into were made with the same engine.
 *
 * A patch replaces content, never code: `main.js`, `preload.js` and `renderer.js` live inside the
 * installed application's archive, and the engine is inlined into the last of those. So the copy in
 * front of the player goes on running the engine it was installed with, while the content in the
 * patch was compiled - and tried out by the author - against whatever engine their Studio bundles
 * now. Upgrading Studio between the build and the patch is enough to part the two.
 *
 * Deliberately a comparison of two packs and nothing else. Both sides of a patch export are already
 * read as packs (the payload being sealed and the build being patched), and every other route to the
 * engine version - the installed archive's manifest, the Studio that is running - answers for
 * something other than the two artifacts in question.
 */
export type PatchEngineCheck =
    /** Both packs name an engine and they are the same one. */
    | { outcome: "match"; version: string }
    /** Both packs name an engine and they differ. `installed` is what the player will keep running. */
    | { outcome: "changed"; installed: string; patch: string }
    /**
     * One of the two does not say, so nothing was compared.
     *
     * `installed-silent` is every build made before packs carried an engine version, and it is the
     * ordinary case for a while yet. `patch-silent` means this Studio's own runtime build predates
     * the field, which is a stale `dist/runtime` rather than anything about the author's project.
     *
     * Reported rather than swallowed. A check that says nothing when it could not run is
     * indistinguishable from one that ran and found nothing wrong, and the two lead the author to
     * opposite conclusions about a file they are about to ship.
     */
    | { outcome: "unchecked"; reason: "installed-silent" | "patch-silent" };

/**
 * Compare the engine a patch was made with against the engine the build it updates ships.
 *
 * `installed` is the pack of the build being patched - the one the player already has - and `patch`
 * is the pack this export just compiled.
 */
export function checkPatchEngine(
    installed: Pick<GameRuntimePackV1, "engineVersion">,
    patch: Pick<GameRuntimePackV1, "engineVersion">,
): PatchEngineCheck {
    const installedVersion = installed.engineVersion?.trim();
    const patchVersion = patch.engineVersion?.trim();
    // The patch side first: a stale runtime build makes every comparison impossible, and saying the
    // installed build is silent would send the author looking at the wrong artifact.
    if (!patchVersion) {
        return { outcome: "unchecked", reason: "patch-silent" };
    }
    if (!installedVersion) {
        return { outcome: "unchecked", reason: "installed-silent" };
    }
    return installedVersion === patchVersion
        ? { outcome: "match", version: patchVersion }
        : { outcome: "changed", installed: installedVersion, patch: patchVersion };
}

/**
 * The line the build console prints for a check, and the level it prints it at.
 *
 * `warning`, never a refusal, and the reasoning is about the artifact rather than the author's
 * patience. What is established when the versions differ is that the player will run this content on
 * an engine the author never saw it on - a gap in what was verified. What is NOT established is that
 * the content behaves differently there; that depends on what changed between two engine releases,
 * which neither Studio nor this comparison knows. Reporting a certainty nobody has would be the same
 * defect as staying silent, in the other direction.
 *
 * The remedy is the author's to choose and it is a real one: ship a full build instead of a patch,
 * and the player gets the engine the content was made for. A refusal would take that decision away
 * from the only party who can weigh it.
 */
export function describePatchEngineCheck(check: PatchEngineCheck): {
    level: "info" | "warning";
    message: string;
} {
    switch (check.outcome) {
        case "match":
            return {
                level: "info",
                message: `the build this patch updates runs the same engine this patch was made with (${check.version})`,
            };
        case "changed":
            return {
                level: "warning",
                message: `this patch was made with engine ${check.patch} and the build it updates runs `
                    + `engine ${check.installed}; a patch cannot replace the engine, so players run this `
                    + `content on ${check.installed} - build the game again instead to give them ${check.patch}`,
            };
        case "unchecked":
            return {
                level: "warning",
                message: check.reason === "installed-silent"
                    ? "the build this patch updates does not say which engine it runs, so nothing was checked "
                        + "about the engine"
                    : "this Studio's runtime build does not say which engine it bundles, so nothing was checked "
                        + "about the engine; rebuild the runtime",
            };
    }
}
