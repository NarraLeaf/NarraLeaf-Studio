/**
 * How a run of a project holds its content: sealed in a protected store, or as loose files.
 *
 * Two questions, answered in order. The project decides whether protection exists at all; the
 * machine decides whether *this* run rehearses it (`previewAsShipped.ts`). Nothing else about the
 * compile changes, so a sealed run produces the artifact a protected production build produces -
 * same store, same empty manifest, same runtime-file whitelist, same codec - and a loose one
 * produces the artifact an unprotected build produces.
 *
 * # One answer, not one per host
 *
 * A preview and a headless test run are the same question asked twice, so they ask this. The test
 * run used to answer it for itself, with no second question at all: it sealed on every launch of
 * every project that had protection on. A store has no way to replace one entry, so that is every
 * asset re-sealed per run - measured on a real-size project at around six seconds against under
 * two - for an artifact nobody receives, on the one launch path an author repeats most.
 *
 * It is not free to skip either, which is why this is a switch rather than a rule. A sealed store
 * behaves differently by construction in three ways: an asset has no file path, a runtime file
 * outside the store's allowed names cannot be read, and the manifest is empty so everything
 * resolves by id. Left off for a whole project, those three surface for the first time in a
 * shipped build - which is exactly what a test run is meant to catch first.
 */

import { readProjectConfigFromDir } from "./projectConfigFile";
import { resolvePreviewAsShipped, type PreviewAsShippedSettingsReader } from "./previewAsShipped";

/**
 * Whether a run seals its content, and why not when it does not.
 *
 * The two "no" answers are kept apart because only one of them is a choice: a project with asset
 * protection off has nothing to seal, while a project with it on is running loose files because
 * this machine asked for the fast path, and that is worth saying on the console.
 */
export type RunSealing =
    | { kind: "unprotected" }
    | { kind: "loose-by-choice" }
    | { kind: "sealed"; key: string };

export type RunSealingInput = {
    projectPath: string;
    /** The machine's global settings, where the per-project choice lives. */
    settings: PreviewAsShippedSettingsReader;
    /**
     * How this host obtains the pack key. Injected rather than imported, because the key comes out
     * of a native binding and the decision above it does not - which is what lets the decision be
     * tested without one.
     */
    resolveKey: () => Promise<string>;
};

export async function resolveRunSealing(input: RunSealingInput): Promise<RunSealing> {
    const projectConfig = await readProjectConfigFromDir(input.projectPath).catch(() => null);
    const enabled =
        (projectConfig?.app as { security?: { encryptAssets?: unknown } } | undefined)?.security?.encryptAssets === true;
    if (!enabled) {
        return { kind: "unprotected" };
    }
    if (!resolvePreviewAsShipped(input.settings, input.projectPath)) {
        return { kind: "loose-by-choice" };
    }
    return { kind: "sealed", key: await input.resolveKey() };
}

/**
 * What a run says about how it is holding its content, or null when there is nothing to say.
 *
 * Null for an unprotected project: it has no second state to be in, so a line about it would be
 * noise on every launch of every project that never turned protection on.
 */
export function runSealingLogLine(sealing: RunSealing): string | null {
    switch (sealing.kind) {
        case "sealed":
            return "asset protection enabled; encrypting pack";
        case "loose-by-choice":
            return "asset protection enabled; running loose files (Preview as shipped is off)";
        default:
            return null;
    }
}
