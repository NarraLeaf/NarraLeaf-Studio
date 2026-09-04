import type {
    CommandLineLintResult,
    CommandLineRunLogLine,
    CommandLineTestResult,
} from "./commandLineRun";

/**
 * `narraleaf-studio --test <project>` and `--lint <project>`: one check, no interface, an exit code.
 *
 * The two share a file because they share everything except the verb. Both open the project's
 * workspace without showing it, both run the machinery the author's own Run menu runs, both answer
 * one question about the project, and both end in a process exiting on a code a job reads. What
 * differs is which service is asked and what a failure means.
 *
 * The flags, the exit codes and the report are set out for an operator in `docs/command-line.md`.
 *
 * ## Why the codes match the build's
 *
 * A job that runs all three in a row should not need three tables. `success`, `invocation` and
 * `studio-failed` mean exactly what they mean for `--build` and carry the same numbers; the two
 * that differ are named for what they are here - the project failed the check, or the check was
 * refused before it ran.
 */

export type CommandLineCheckOutcome =
    /** The check ran and the project passed it. */
    | "success"
    /**
     * The check ran and the project did not pass: a test whose verdict is `failed`, or a lint sweep
     * that reported at least one finding the project configures as an error. Retrying changes
     * nothing until the project does.
     */
    | "check-failed"
    /**
     * The command line could not be acted on: a project path that resolves to nothing, a test id no
     * registry answers to, a parameter value the test does not offer. Nothing was opened.
     */
    | "invocation"
    /**
     * The check exists and was not allowed to run - a windowed test on a frozen workspace, a test
     * another run already holds the slot for. Says nothing about whether the project would pass.
     */
    | "refused"
    /**
     * Studio itself could not get far enough to answer - the workspace would not open, the window
     * went away mid-run, another Studio already owns this profile. Says nothing about the project.
     */
    | "studio-failed";

/**
 * The process exit code each outcome leaves.
 *
 * A `Record` keyed by the union rather than a switch, so an outcome added later cannot compile
 * without a code. The numbers are `COMMAND_LINE_BUILD_EXIT_CODES`' numbers, position for position:
 * a pipeline that already knows what 2 and 4 mean from a build knows what they mean here.
 */
export const COMMAND_LINE_CHECK_EXIT_CODES: Record<CommandLineCheckOutcome, number> = {
    success: 0,
    "check-failed": 1,
    invocation: 2,
    refused: 3,
    "studio-failed": 4,
};

/** Report format version. Bumped when a field changes meaning, never when one is added. */
export const COMMAND_LINE_CHECK_REPORT_SCHEMA = 1;

/**
 * One test as `--test-list` reports it.
 *
 * `presentation` is the field this listing exists for. A test declares itself `headless` or
 * `windowed` and nothing outside the picker could ever read that, which is what made "the framework
 * has two modes and no way to ask for either" true: a job cannot decide whether a machine with no
 * screen may run something it cannot see the mode of.
 */
export type CommandLineTestListing = {
    id: string;
    title: string;
    category: string;
    presentation: "headless" | "windowed";
    /** The plugin that contributed it. Absent for the tests Studio ships. */
    ownerPluginId?: string;
    /** Whether it could be started right now, and why not when it could not. */
    available: boolean;
    unavailableReason?: string;
    parameters: CommandLineTestParameterListing[];
};

/** One value a test asks for, and what may be given for it on the line. */
export type CommandLineTestParameterListing = {
    id: string;
    kind: "select" | "boolean";
    label: string;
    /** Every accepted value, for a `select`. Absent for a `boolean`, which takes true or false. */
    values?: string[];
    /** What the run uses when the line names no value for it. */
    defaultValue?: string;
};

/**
 * The file `--test-report` or `--lint-report` writes.
 *
 * Written for every outcome including the ones that never opened a window, so a job that reads the
 * report always finds one. `log` carries the whole console rather than a tail: this file is the
 * archivable record of the run, and a truncated log is the half that never has the line you came
 * for.
 */
export type CommandLineCheckReport = {
    schema: typeof COMMAND_LINE_CHECK_REPORT_SCHEMA;
    /** Which of the two entry points wrote this. */
    check: "test" | "lint";
    result: CommandLineCheckOutcome;
    exitCode: number;
    /** Studio's own version, so a report can be read against the Studio that produced it. */
    studioVersion: string;
    project: {
        /** Absolute, as Studio resolved it. Absent when the launch named nothing that resolved. */
        path?: string;
        name?: string;
    };
    startedAt: number;
    finishedAt: number;
    durationMs: number;
    /** Present for a `--test` run that reached a verdict. */
    test?: CommandLineTestResult;
    /** Present for a `--lint` sweep that finished. */
    lint?: CommandLineLintResult;
    /** Present for `--test-list`, which answers about the registry rather than about the project. */
    tests?: CommandLineTestListing[];
    /** One sentence saying what went wrong, or null when nothing did. */
    error: string | null;
    log: CommandLineRunLogLine[];
};
