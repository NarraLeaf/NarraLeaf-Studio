import type { DevModeConsoleLogLevel } from "./devMode";
import type { ExperimentalConditionId } from "./experimental";
import type {
    BuildPreflightFinding,
    GameBuildArch,
    GameBuildArtifactSize,
    GameBuildFormat,
    GameBuildPlatform,
} from "./gameBuild";

/**
 * A build started from the command line rather than from the Build dialog.
 *
 * The shapes here are shared by three sides: the main process parses the launch and writes the
 * report, the workspace renderer runs the checks and the build, and the report is read by whatever
 * called Studio.
 *
 * Nothing in this file is author-facing copy. A build started this way logs the same lines the Build
 * console shows, in the catalogue's source language rather than the machine's - see
 * `runCommandLineBuild` for why - and the report beside them is read by a script, so every value in
 * it is a fixed identifier rather than a sentence.
 */

/**
 * How a command-line build ended. One value per reaction a pipeline can usefully have.
 *
 * The distinction that matters most is between {@link CommandLineBuildOutcome} `"gate-refused"` and
 * `"studio-failed"`. A project whose story has an unresolved command is a project someone has to
 * change; Studio failing to open the project is a machine someone has to look at. Collapsing them
 * would make "retry the job" the right answer half the time and a waste of ten minutes the other
 * half.
 */
export type CommandLineBuildOutcome =
    /** The build ran and wrote its artifacts. */
    | "success"
    /**
     * A check refused the project, so the build never started. The findings are in the report and
     * the reasons are on the log. Retrying changes nothing until the project does.
     */
    | "gate-refused"
    /**
     * The checks passed and the build itself did not finish - the packager failed, a credential
     * would not unseal, a compile threw. The pipeline's own message is in `error`.
     */
    | "build-failed"
    /**
     * The command line could not be acted on: a project path that resolves to nothing, a platform
     * this host cannot build for, a format the platform does not offer. Nothing was opened.
     */
    | "invocation"
    /**
     * Studio itself could not get far enough to answer - the workspace would not open, the window
     * went away mid-build, another Studio already owns this profile. Says nothing about the project.
     */
    | "studio-failed";

/**
 * The process exit code each outcome leaves.
 *
 * A `Record` keyed by the union rather than a switch, so an outcome added later cannot compile
 * without a code. `2` is the invocation error by long convention (a usage error, not a failure of
 * the work asked for), which leaves `1` for the build failing - the outcome a pipeline sees most.
 */
export const COMMAND_LINE_BUILD_EXIT_CODES: Record<CommandLineBuildOutcome, number> = {
    success: 0,
    "build-failed": 1,
    invocation: 2,
    "gate-refused": 3,
    "studio-failed": 4,
};

/** Report format version. Bumped when a field changes meaning, never when one is added. */
export const COMMAND_LINE_BUILD_REPORT_SCHEMA = 1;

/** One line of the build log, as the Build console recorded it. */
export type CommandLineBuildLogLine = {
    timestamp: number;
    level: DevModeConsoleLogLevel;
    /** Which part of the pipeline spoke - "Build", "Lint". Absent for lines that carry no source. */
    source?: string;
    message: string;
};

/**
 * What the workspace tells the main process while a command-line build runs.
 *
 * One event with a discriminated payload rather than two, because the two halves are one stream:
 * the log lines and the outcome arrive in order and are written to one report. A second IPC event
 * would be a second thing to keep in step for no gain.
 */
export type CommandLineBuildEvent =
    | ({ kind: "log" } & CommandLineBuildLogLine)
    | {
        kind: "finished";
        /** Whether the build produced its artifacts. */
        ok: boolean;
        /** The pipeline's or the refusing check's own message, when it failed. */
        error?: string;
        outputDir?: string;
        artifacts?: string[];
        artifactSizes?: GameBuildArtifactSize[];
        startedAt?: number;
        finishedAt?: number;
    };

/** What the launch was asked to produce, restated in the report so the file stands alone. */
export type CommandLineBuildReportRequest = {
    variant: string;
    platform: GameBuildPlatform;
    formats: GameBuildFormat[];
    /** Absent for the web and mobile platforms, which have no CPU architecture. */
    arch?: GameBuildArch;
    outputDir: string;
};

/**
 * What experimental mode did to this run.
 *
 * Three values rather than a boolean, for the reason `signing` below has three fields rather than
 * one: "nothing asked for it" and "it was asked for and did not happen" are different news, and a
 * single flag would make them indistinguishable. The artifact cannot be inspected to tell them
 * apart - a debuggable build looks like any other build - so this field is the only place a job
 * that archived one can find out which it has.
 */
export type CommandLineBuildExperimentalState =
    /** Nothing asked for the mode and nothing is on. An ordinary artifact. */
    | "off"
    /**
     * The mode is open. {@link CommandLineBuildReportExperimental.conditions} is what it changed
     * about this build - empty when `--experimental` was given with no condition, which changes
     * nothing about the artifact.
     */
    | "on"
    /**
     * The launch asked for the mode, or for one of its conditions, and did not get it. No artifact
     * was produced: see `CommandLineBuildRun` for why this refuses rather than warns.
     */
    | "refused";

/**
 * Why a `"refused"` run was refused, as an identifier rather than the sentence on the log.
 *
 * A job acts on them differently: two are mistakes in the line it was given, and one is a Studio
 * that cannot do this at all, however the line is written.
 */
export type CommandLineBuildExperimentalRefusal =
    /**
     * This Studio cannot enter experimental mode at all. A packaged Studio never does - see
     * `BaseApp.getExperimentalState` - which is what keeps an installed Studio from ever producing
     * a build the mode changed.
     */
    | "unavailable"
    /** Condition flags were given without `--experimental`, so none of them would have applied. */
    | "mode-not-opened"
    /** A `--x-` flag names no registered condition, so what it asked for was never going to happen. */
    | "unknown-condition";

/** The report's account of experimental mode. Present for every outcome, like `signing`. */
export type CommandLineBuildReportExperimental = {
    state: CommandLineBuildExperimentalState;
    /** Why, when `state` is `"refused"`. Absent otherwise. */
    refusal?: CommandLineBuildExperimentalRefusal;
    /**
     * Conditions active for this build, in registry order. Empty unless `state` is `"on"`.
     *
     * This is the field that says what the artifact is. A build whose list holds `debuggable-build`
     * ships without asar integrity validation and is not one to distribute.
     */
    conditions: ExperimentalConditionId[];
    /**
     * Every registered condition the launch named, honoured or not.
     *
     * The same list as {@link conditions} on an honoured run, and the thing a refusal report is
     * read for: it says what the caller believed it was getting.
     */
    requestedConditions: ExperimentalConditionId[];
    /** `--x-` flags that name no registered condition, exactly as they were typed. */
    unknownConditionFlags: string[];
};

/**
 * The file `--build-report` writes.
 *
 * Written for every outcome including the ones that never opened a window, so a job that reads the
 * report always finds one. `log` carries the whole build console rather than a tail: this file is
 * the archivable record of the run, and a truncated log is the half that never has the line you
 * came for.
 */
export type CommandLineBuildReport = {
    schema: typeof COMMAND_LINE_BUILD_REPORT_SCHEMA;
    result: CommandLineBuildOutcome;
    exitCode: number;
    /** Studio's own version, so a report can be read against the Studio that produced it. */
    studioVersion: string;
    project: {
        /** Absolute, as Studio resolved it. Absent when the launch named nothing that resolved. */
        path?: string;
        name?: string;
    };
    /** Absent when the launch was refused before a request could be assembled. */
    request?: CommandLineBuildReportRequest;
    startedAt: number;
    finishedAt: number;
    durationMs: number;
    signing: {
        /**
         * Whether an artifact of this platform can carry an OS-enforced code signature at all.
         *
         * False for the web export, the mobile packages and Linux - a page has nothing to sign, and
         * Linux's detached GPG signatures are distribution integrity rather than a signature over
         * the binary. Reported separately from {@link signed} because collapsing them is the exact
         * lie this field exists to prevent: "not signed" and "there is nothing here to sign" would
         * otherwise both read as `false` and be told apart by nothing.
         */
        signable: boolean;
        /** Whether this build actually carried one. Never true when `signable` is false. */
        signed: boolean;
        /** Whether the launch passed `--build-allow-unsigned`. */
        unsignedAccepted: boolean;
    };
    /**
     * What experimental mode did to this run.
     *
     * Here rather than left to the log, for the same reason `signing` is: the console says it in
     * sentences, and a job that had to grep English to find out whether it just archived a
     * debuggable artifact has no contract at all.
     */
    experimental: CommandLineBuildReportExperimental;
    /** Everything the build reported about the project's configuration, blocking or not. */
    findings: BuildPreflightFinding[];
    artifacts: Array<{ path: string; bytes?: number }>;
    /** One sentence saying what went wrong, or null on success. */
    error: string | null;
    log: CommandLineBuildLogLine[];
};
