import type { DevModeConsoleLogLevel } from "./devMode";
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
    /** Everything the build reported about the project's configuration, blocking or not. */
    findings: BuildPreflightFinding[];
    artifacts: Array<{ path: string; bytes?: number }>;
    /** One sentence saying what went wrong, or null on success. */
    error: string | null;
    log: CommandLineBuildLogLine[];
};
