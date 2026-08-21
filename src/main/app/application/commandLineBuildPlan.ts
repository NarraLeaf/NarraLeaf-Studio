import path from "path";
import { APP_TAG_ID_RELEASE } from "@shared/types/appTag";
import {
    defaultGameBuildArch,
    GAME_BUILD_ARCHS_BY_PLATFORM,
    GAME_BUILD_FORMATS_BY_PLATFORM,
    hostCanBuildTarget,
    isDesktopBuildPlatform,
    type GameBuildArch,
    type GameBuildDesktopPlatform,
    type GameBuildFormat,
    type GameBuildPlatform,
    type GameBuildRequest,
} from "@shared/types/gameBuild";
import type { CommandLineBuildReportExperimental } from "@shared/types/commandLineBuild";
import {
    EXPERIMENTAL_CONDITION_IDS,
    EXPERIMENTAL_FLAG,
    experimentalCondition,
    type ExperimentalState,
} from "@shared/types/experimental";
import type { BuildCommandLineOptions, ExperimentalCommandLineOptions } from "./commandLine";

/**
 * What `--build` and its flags come to: one variant, one platform, one format.
 *
 * Deliberately not a matrix. A run that produced several targets would have to answer "what does
 * the exit code mean when two of five failed", and every answer to that is worse than running the
 * command twice. One invocation, one artifact set, one exit code.
 *
 * Pure, and separate from the controller that acts on it, so every refusal below is decided without
 * opening a window and can be read back in a test.
 */

export type CommandLineBuildPlan = {
    request: GameBuildRequest;
    platform: GameBuildPlatform;
    format: GameBuildFormat;
    /** Absent for the web and mobile platforms, which have no CPU architecture. */
    arch?: GameBuildArch;
    variantId: string;
    outputDir: string;
    allowUnsigned: boolean;
    /** Absolute, or null when the launch asked for no report file. */
    reportPath: string | null;
};

export type CommandLineBuildPlanResult =
    | { ok: true; plan: CommandLineBuildPlan }
    | { ok: false; reason: string };

/** Every platform a project can be built for, in the order the format table lists them. */
const ALL_PLATFORMS = Object.keys(GAME_BUILD_FORMATS_BY_PLATFORM) as GameBuildPlatform[];

function isPlatform(candidate: string): candidate is GameBuildPlatform {
    return (ALL_PLATFORMS as string[]).includes(candidate);
}

/**
 * Turn a parsed command line into one build request, or say why it cannot be one.
 *
 * `projectPath` is already resolved against the disk by the caller - this decides everything else:
 * which platform, which format, which architecture, and where the artifacts land.
 *
 * `workingDirectory` is what a relative `--build-output` or `--build-report` is resolved against.
 * The process's own, always: a launch names paths the way the shell that wrote it does.
 */
export function planCommandLineBuild(input: {
    options: BuildCommandLineOptions;
    projectPath: string;
    hostPlatform: GameBuildDesktopPlatform;
    hostArch: string;
    workingDirectory: string;
}): CommandLineBuildPlanResult {
    const { options, projectPath, hostPlatform, hostArch, workingDirectory } = input;

    const platformName = options.platform ?? hostPlatform;
    if (!isPlatform(platformName)) {
        return { ok: false, reason: `Unknown --build-target "${platformName}". Expected one of: ${ALL_PLATFORMS.join(", ")}.` };
    }
    const platform = platformName;
    if (!hostCanBuildTarget(hostPlatform, platform)) {
        // The same sentence the pipeline uses for a stored selection carried across hosts, because
        // it is the same fact: macOS needs a Mac, Linux needs a Unix host.
        return { ok: false, reason: `Cannot build for ${platform} on this machine. macOS builds require a Mac; Linux builds require a Unix host.` };
    }

    const offered = GAME_BUILD_FORMATS_BY_PLATFORM[platform];
    // The platform's first offered format, which is the project's own declared order rather than a
    // preference invented here: zip for the three desktops and the web, apk for Android, ipa for
    // iOS. A run that wants an installer says so.
    const formatName = options.format ?? offered[0];
    const format = offered.find(candidate => candidate === formatName);
    if (!format) {
        return { ok: false, reason: `The ${platform} platform has no format "${formatName}". Expected one of: ${offered.join(", ")}.` };
    }

    let arch: GameBuildArch | undefined;
    if (isDesktopBuildPlatform(platform)) {
        const allowed = GAME_BUILD_ARCHS_BY_PLATFORM[platform];
        const requested = options.arch ?? defaultGameBuildArch(platform, hostPlatform, hostArch);
        const matched = allowed.find(candidate => candidate === requested);
        if (!matched) {
            return { ok: false, reason: `The ${platform} platform cannot be built for "${requested}". Expected one of: ${allowed.join(", ")}.` };
        }
        arch = matched;
    } else if (options.arch !== null) {
        // Refused rather than ignored. A line that names an architecture for the web believes it is
        // getting one, and a silently dropped flag is how a script ships the wrong thing for months.
        return { ok: false, reason: `--build-arch does not apply to the ${platform} platform, which has no CPU architecture.` };
    }

    const variantId = options.variantId ?? APP_TAG_ID_RELEASE;
    const outputDir = options.outputDir
        ? path.resolve(workingDirectory, options.outputDir)
        : path.join(projectPath, "dist");

    return {
        ok: true,
        plan: {
            request: {
                targets: [{ platform, formats: [format], ...(arch ? { arch } : {}) }],
                appTagId: variantId,
                outputDir,
                // Never. `openWhenDone` reveals the output folder in the file manager, which on a
                // machine somebody is using is a window appearing out of nowhere - and on a build
                // agent is a file manager nobody will ever close.
                openWhenDone: false,
            },
            platform,
            format,
            ...(arch ? { arch } : {}),
            variantId,
            outputDir,
            allowUnsigned: options.allowUnsigned,
            reportPath: options.reportPath ? path.resolve(workingDirectory, options.reportPath) : null,
        },
    };
}

/** What experimental mode came to for this run: what the report says, and whether to build at all. */
export type CommandLineBuildExperimentalResult = {
    /** The report's account of the mode, whichever way this went. */
    report: CommandLineBuildReportExperimental;
    /** The sentence to refuse the launch with, or null to go on and build. */
    refusal: string | null;
};

/**
 * Answer for experimental mode before anything is opened.
 *
 * `requested` is what the command line asked for; `honoured` is what `BaseApp.getExperimentalState`
 * decided to give it. The two differ exactly where a launch asked for something it did not get, and
 * closing that gap is what this is for.
 *
 * ## Why a launch that asked and did not get it is refused rather than warned
 *
 * The mode's one shipped condition changes the artifact and nothing about the artifact records it.
 * So `--build --experimental --x-debuggable-build` on a Studio that cannot enter the mode produces a
 * *production* build while the caller believes it is holding a debuggable one, and the same is true
 * of a condition flag typed without `--experimental`. Both are the failure this whole area exists to
 * prevent, arriving through the one entry point with nobody watching: a warning on a log is read by
 * a person, and there is no person.
 *
 * A pipeline whose job fails is a pipeline that stops. A pipeline handed the opposite of what it
 * asked for archives it, signs it, and ships it. The first is recoverable in a minute and the second
 * is recoverable only by whoever eventually notices, so this refuses.
 *
 * `--experimental` alone - which no condition follows, and which therefore would have changed
 * nothing - is refused on the same terms rather than let through. The carve-out would have to be
 * "the mode was unavailable but nothing it unlocks was wanted", which is a judgement about what each
 * condition does, made in the one place that must not have to know. One rule: asked for and not
 * given is refused.
 *
 * An unknown `--x-` flag is refused for the third time in the same shape. `--x-debugable-build` is a
 * typo away from the real one and produces exactly the artifact a typo should not produce silently;
 * `planCommandLineBuild` refuses a `--build-arch` the platform has no use for on the same reasoning.
 */
export function resolveCommandLineBuildExperimental(
    requested: ExperimentalCommandLineOptions,
    honoured: ExperimentalState,
): CommandLineBuildExperimentalResult {
    const requestedConditions = [...requested.conditions];
    const unknownConditionFlags = [...requested.unknownConditionFlags];
    const askedForSomething = requested.requested
        || requestedConditions.length > 0
        || unknownConditionFlags.length > 0;

    if (!askedForSomething) {
        return {
            report: {
                state: "off",
                conditions: [],
                requestedConditions: [],
                unknownConditionFlags: [],
            },
            refusal: null,
        };
    }

    const asked = { requestedConditions, unknownConditionFlags };
    // The flags as an operator would type them, which is what a refusal has to name: a condition id
    // on its own is not something anybody can search their own command line for.
    const flags = [
        ...requestedConditions.map(id => experimentalCondition(id).flag),
        ...unknownConditionFlags,
    ];

    if (!honoured.enabled) {
        // The mode is off for one of two reasons and the line says which: `getExperimentalState`
        // refuses a packaged Studio and refuses a launch that never opened the mode, so a launch
        // that did carry `--experimental` and still has it off was refused by the Studio.
        if (requested.requested) {
            const listed = flags.length > 0 ? flags.join(" ") : EXPERIMENTAL_FLAG;
            return {
                report: { state: "refused", refusal: "unavailable", conditions: [], ...asked },
                refusal: `This Studio cannot enter experimental mode, so ${listed} would have changed`
                    + " nothing about this build. Experimental mode is available to a development"
                    + " launch only; a packaged Studio always refuses it.",
            };
        }
        return {
            report: { state: "refused", refusal: "mode-not-opened", conditions: [], ...asked },
            refusal: `${flags.join(" ")} asks for an experimental condition without ${EXPERIMENTAL_FLAG},`
                + ` so none of them apply. Pass ${EXPERIMENTAL_FLAG} as well, or drop them.`,
        };
    }

    if (unknownConditionFlags.length > 0) {
        return {
            report: { state: "refused", refusal: "unknown-condition", conditions: [], ...asked },
            refusal: `${unknownConditionFlags.join(" ")} names no experimental condition.`
                + ` The registered conditions are: ${EXPERIMENTAL_CONDITION_IDS.join(", ")}.`,
        };
    }

    return {
        report: { state: "on", conditions: [...honoured.conditions], ...asked },
        refusal: null,
    };
}
