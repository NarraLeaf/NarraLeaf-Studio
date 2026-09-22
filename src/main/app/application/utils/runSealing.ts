/**
 * How a run of a project holds its content: sealed in a protected store, or as loose files.
 *
 * Two questions, answered in order. The project decides whether protection exists at all; the run
 * decides whether *it* rehearses it. Nothing else about the compile changes, so a sealed run
 * produces the artifact a protected production build produces - same store, same empty manifest,
 * same runtime-file whitelist, same codec - and a loose one produces the artifact an unprotected
 * build produces.
 *
 * # One answer, not one per host
 *
 * A preview and a test's game are the same question asked twice, so they ask this. The test run
 * used to answer it for itself, with no second question at all: it sealed on every launch of every
 * project that had protection on. A store has no way to replace one entry, so that is every asset
 * re-sealed per run - measured on a real-size project at around six seconds against under two -
 * for an artifact nobody receives, on the one launch path an author repeats most.
 *
 * It is not free to skip either, which is why this is a switch rather than a rule. A sealed store
 * behaves differently by construction in three ways: an asset has no file path, a runtime file
 * outside the store's allowed names cannot be read, and the manifest is empty so everything
 * resolves by id. Left off for a whole project, those three surface for the first time in a
 * shipped build - which is exactly what a test run is meant to catch first.
 *
 * # Who asks for the shipped form
 *
 * Two different people, so two sources - {@link RunSealingChoice}. A run an author starts reads the
 * machine's "Preview as shipped" setting (`previewAsShipped.ts`): it is that author's habit at that
 * machine. A run started by `--test` reads the line (`--test-as-shipped`) and nothing else. It has
 * no author at the screen whose habit it could inherit, and the machine it happens to run on is not
 * a thing a job's result should depend on: a build agent never set the setting, so reading it would
 * mean a job never tested the sealed path, and a developer's own machine did, so the same line
 * would test something different there.
 */

import { readProjectConfigFromDir } from "./projectConfigFile";
import { resolvePreviewAsShipped, type PreviewAsShippedSettingsReader } from "./previewAsShipped";

/**
 * Whether this run was asked for the shipped form, and by what.
 *
 * - `preview-setting`: the machine's per-project "Preview as shipped" switch. Every run an author
 *   starts - a preview, a test from the Run ▸ Test picker.
 * - `command-line`: `--test-as-shipped` on a headless `--test` run, which is the whole of the
 *   answer for that run. The setting is not consulted at all.
 */
export type RunSealingChoice =
    | { by: "preview-setting"; settings: PreviewAsShippedSettingsReader }
    | { by: "command-line"; asShipped: boolean };

/**
 * Whether a run seals its content, and why not when it does not.
 *
 * The two "no" answers are kept apart because only one of them is a choice: a project with asset
 * protection off has nothing to seal, while a project with it on is running loose files because
 * this run asked for the fast path, and that is worth saying on the console.
 *
 * `by` and `asked` are carried along for the one thing that reads them, {@link runSealingLogLine}:
 * the sentence has to name what made the choice, and a headless run has to say even of an
 * unprotected project that the shipped form it asked for is the loose one.
 */
export type RunSealing = { by: RunSealingChoice["by"]; asked: boolean } & (
    | { kind: "unprotected" }
    | { kind: "loose-by-choice" }
    | { kind: "sealed" }
);

export type RunSealingInput = {
    projectPath: string;
    /** Where this run's "as shipped" answer comes from. See {@link RunSealingChoice}. */
    choice: RunSealingChoice;
};

/**
 * The answer is a decision and nothing more: a sealed run hands the compile `protectAssets` and
 * the codec package makes everything the store is sealed with itself, fresh for that compile. There
 * is no key for a host to fetch or keep.
 */
export async function resolveRunSealing(input: RunSealingInput): Promise<RunSealing> {
    const { choice } = input;
    const asked = choice.by === "command-line"
        ? choice.asShipped
        : resolvePreviewAsShipped(choice.settings, input.projectPath);
    const projectConfig = await readProjectConfigFromDir(input.projectPath).catch(() => null);
    const enabled =
        (projectConfig?.app as { security?: { encryptAssets?: unknown } } | undefined)?.security?.encryptAssets === true;
    if (!enabled) {
        return { by: choice.by, asked, kind: "unprotected" };
    }
    if (!asked) {
        return { by: choice.by, asked, kind: "loose-by-choice" };
    }
    return { by: choice.by, asked, kind: "sealed" };
}

/**
 * What a run says about how it is holding its content, or null when there is nothing to say.
 *
 * Null only for an unprotected project in a run an author started: it has no second state to be in,
 * so a line about it would be noise on every launch of every project that never turned protection
 * on. A headless run always says, because its log is the only record a job keeps of which path was
 * exercised, and "nothing about the content" reads the same as "the line was never read".
 */
export function runSealingLogLine(sealing: RunSealing): string | null {
    if (sealing.by === "command-line") {
        switch (sealing.kind) {
            case "sealed":
                return "assets: sealed in a protected store, as this project's release build holds them (--test-as-shipped)";
            case "loose-by-choice":
                return "assets: loose files; this project's release build seals them, which --test-as-shipped would test";
            default:
                return sealing.asked
                    ? "assets: loose files - asset protection is off, so that is how this project ships and --test-as-shipped has nothing to seal"
                    : "assets: loose files, as this project ships (asset protection is off)";
        }
    }
    switch (sealing.kind) {
        case "sealed":
            return "asset protection enabled; encrypting pack";
        case "loose-by-choice":
            return "asset protection enabled; running loose files (Preview as shipped is off)";
        default:
            return null;
    }
}
