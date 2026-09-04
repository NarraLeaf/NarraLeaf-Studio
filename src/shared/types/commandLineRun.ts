import type { DevModeConsoleLogLevel } from "./devMode";
import type { CommandLineTestListing } from "./commandLineCheck";
import type { GameBuildArtifactSize, GameBuildRequest } from "./gameBuild";

/**
 * What a launch with no interface asked a workspace to do, and what the workspace says back.
 *
 * Three jobs share one mechanism: `--build` produces an artifact, `--test` runs one test from the
 * test registry, `--lint` sweeps the project's lint rules. All three need the same four things -
 * a project opened in a window nobody sees, the workspace's own services rather than a second
 * implementation of them, a stream of console lines, and a process that exits on a code - so they
 * are one transport with a job on the front rather than three that would drift apart.
 *
 * Nothing here is author-facing copy. A run started this way logs in the catalogue's source
 * language rather than the machine's (see `runCommandLineBuild` for why), and the reports beside
 * the lines are read by scripts, so every value in them is a fixed identifier rather than a
 * sentence.
 */

/** What the window opened by a command-line launch is there to do. */
export type CommandLineRunJob =
    /** `--build`: one variant, one platform, one format. See `commandLineBuild.ts`. */
    | { kind: "build"; request: GameBuildRequest }
    /**
     * `--test`: one registered test, with the values it declared.
     *
     * The values are the raw strings the line carried. What each one means is decided against the
     * test's own declarations in the workspace, which is the only side that has them.
     */
    | { kind: "test"; testId: string; parameters: Record<string, string> }
    /**
     * `--test-list`: what the registry holds, rather than a run.
     *
     * A job of its own rather than a flag on the one above, because it answers about Studio and its
     * plugins instead of about the project - it opens a workspace only because that is where the
     * registry lives, and it never starts anything.
     */
    | { kind: "test-list" }
    /** `--lint`: the whole rule registry over the whole project. */
    | { kind: "lint" };

/** One line of a run's log, as the console recorded it. */
export type CommandLineRunLogLine = {
    timestamp: number;
    level: DevModeConsoleLogLevel;
    /** Which part spoke - "Build", "Lint", "Test". Absent for lines that carry no source. */
    source?: string;
    message: string;
};

/**
 * One finding, flattened for a report file.
 *
 * Both halves are here on purpose. `id` is the stable thing a job greps or counts - a lint rule id,
 * a test finding's severity bucket - and `message` is the sentence a person reads when the job
 * fails at three in the morning. A report carrying only the first is unreadable and one carrying
 * only the second is unusable.
 */
export type CommandLineRunFinding = {
    severity: "error" | "warning" | "info";
    /** The rule id for lint. Absent for a test finding, which no registry names. */
    id?: string;
    message: string;
    /** Where it is, when the finding knows - a story name, a scene, an asset. */
    location?: string;
};

/** What a finished `--test` run came to. */
export type CommandLineTestResult = {
    testId: string;
    /** The registry's own title, rendered in the source language. */
    title: string;
    /** Which of the two modes this test declared. The whole reason a command line can ask for it. */
    presentation: "headless" | "windowed";
    /**
     * The run's terminal state.
     *
     * Five rather than a boolean, because `cancelled` and `errored` are verdicts the *host* reached
     * about the test and `skipped` is the test declining to answer - none of which is the test
     * having failed, and a job that treated them as one would retry the wrong things.
     */
    status: "passed" | "failed" | "skipped" | "cancelled" | "errored";
    /** The verdict's own sentence, when it gave one. */
    summary?: string;
    findings: CommandLineRunFinding[];
    startedAt: number;
    finishedAt?: number;
};

/** What a finished `--lint` sweep came to. */
export type CommandLineLintResult = {
    counts: { error: number; warning: number; info: number };
    findings: CommandLineRunFinding[];
    /** Rule ids that ran, and the ones the project turned off. Both in registry order. */
    rulesRun: string[];
    skipped: string[];
    startedAt: number;
    finishedAt: number;
};

/**
 * What the workspace tells the main process while a command-line run is going on.
 *
 * One event with a discriminated payload rather than two, because the two halves are one stream:
 * the log lines and the outcome arrive in order and are written to one report. A second IPC event
 * would be a second thing to keep in step for no gain.
 *
 * `finished` carries at most one of the three result blocks, and which one is decided by the job the
 * window was opened for. They are separate fields rather than a union so that a `finished` that
 * failed before the job produced anything - a workspace that threw, a test that was refused - is
 * the same shape whichever job it was.
 */
export type CommandLineRunEvent =
    | ({ kind: "log" } & CommandLineRunLogLine)
    | {
        kind: "finished";
        /** Whether the job did what it was asked to do. */
        ok: boolean;
        /** The pipeline's, the refusing check's or the thrown error's own message. */
        error?: string;
        outputDir?: string;
        artifacts?: string[];
        artifactSizes?: GameBuildArtifactSize[];
        startedAt?: number;
        finishedAt?: number;
        /** Present exactly when the job was a `--test` run that reached a terminal state. */
        test?: CommandLineTestResult;
        /** Present exactly when the job was `--test-list`. */
        tests?: CommandLineTestListing[];
        /**
         * Why a check never ran, when one never did.
         *
         * Without it, "the line named a test that does not exist" and "the workspace threw on its
         * way up" arrive as the same event - one `ok: false` and a sentence - and a job would have
         * to read English to know whether retrying is worth anything. `invocation` is the caller's
         * mistake, `unavailable` is the host declining for a reason that may pass.
         */
        refusal?: "invocation" | "unavailable";
        /** Present exactly when the job was a `--lint` sweep that finished. */
        lint?: CommandLineLintResult;
    };
