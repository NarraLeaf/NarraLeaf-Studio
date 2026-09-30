import fs from "fs";
import path from "path";
import {
    COMMAND_LINE_BUILD_REPORT_SCHEMA,
    type CommandLineBuildReport,
} from "@shared/types/commandLineBuild";
import {
    COMMAND_LINE_CHECK_EXIT_CODES,
    COMMAND_LINE_CHECK_REPORT_SCHEMA,
    type CommandLineCheckReport,
} from "@shared/types/commandLineCheck";
import type { CommandLineRunLogLine } from "@shared/types/commandLineRun";
import { unpatchedFs } from "../../utils/unpatchedFs";
import { parseMainCommandLine } from "./commandLine";

/**
 * How a command-line run ends when something outside the run's own flow fails.
 *
 * `--build`, `--test` and `--lint` have nobody at the screen, and the rule for everything that would
 * ask a person something is already that it ends the run instead (`unattendedPrompt.ts`). This is
 * the same rule one layer earlier and one layer wider: the failures that belong to the process
 * rather than to a window. Before this, each of them waited on a person who is not there -
 *
 * - **A profile Studio cannot use** - a `--*-user-data-dir` that cannot be created, a settings file
 *   that will not parse. `App.create` throws while the entry point is still loading, and Electron
 *   answers that with an error box and a process that never exits.
 * - **A fatal error in the main process.** `BaseApp.crash` asks whether to restart in a synchronous
 *   message box, which blocks the very thread every deadline runs on.
 * - **Another Studio holding the profile**, which exited with a code but wrote no report.
 * - **A startup that threw** on its way to the run, which quit - and a quit exits 0, so a run that
 *   never started reported success.
 * - **A startup that stalls** before the workspace window exists. The run's silence deadline is
 *   only armed once that window is up, so nothing at all was watching the stretch before it.
 *
 * Each of those now calls {@link endCommandLineRunOnFailure} with the sentence it would have put in
 * front of a person. In a command-line run that ends the run as `studio-failed`, exit 4 - the code
 * both families already give "Studio could not get far enough to answer" - with the sentence on the
 * run's log and in the report the line asked for. In any other launch it does nothing and returns
 * false, and the caller does what it always did for the person in front of it.
 *
 * ## Two ways to end, depending on how far the run got
 *
 * Once `CommandLineBuildRun` / `CommandLineCheckRun` has started it {@link CommandLineRunEnd.attach}es
 * its own `finish`, and a failure goes through exactly the path the run's own failures take: the
 * whole log, the resolved project, the plugins, the drain that puts the profile down. Before that
 * there is no run to hand it to - the process may not even have an `App` - so this writes the two
 * lines and a report of the family's shape itself, synchronously, and exits.
 *
 * ## The watchdog
 *
 * The run's own deadline is an idle one - reset by every line, so a long build is never cut short -
 * and it is armed only once the workspace window is up. The watchdog here is the same idle deadline
 * plus a margin, armed from the first moment of the process and reset by the same lines and by every
 * step on the way to the workspace. So it never fires while the run's own deadline is working; it
 * fires when that deadline is not there yet, or when whatever it started never finishes. It names the
 * step the process was waiting on, because "it hung" is not something anyone can act on.
 *
 * Once the run has decided its outcome, a second, shorter backstop takes over: the teardown is
 * bounded (`App.drainForShutdown`), and a process still alive well past that bound exits with the
 * code the run decided.
 *
 * All of it runs on timers, which a synchronous message box would stop. That is why the rule is that
 * nothing puts one up in a command-line run, rather than that the watchdog rescues one that did.
 */

export type CommandLineRunKind = "build" | "test" | "lint";

/**
 * How long a run's workspace may say nothing before the run gives up on it.
 *
 * An idle deadline, reset by every line: a real build of a large project takes as long as it takes -
 * a first cross-build downloads an Electron runtime - and a walkthrough of a long story the same.
 * What it catches is a window that opened, said nothing, and never will. A build's is shorter
 * because a build logs as it goes, and a check can sit in one long step (a sweep of a large asset
 * library) without a line.
 */
export const COMMAND_LINE_RUN_SILENCE_MS: Readonly<Record<CommandLineRunKind, number>> = {
    build: 15 * 60 * 1000,
    test: 30 * 60 * 1000,
    lint: 30 * 60 * 1000,
};

/** How much longer than the run's own deadline the watchdog waits before it steps in. */
export const COMMAND_LINE_RUN_WATCHDOG_MARGIN_MS = 60 * 1000;

/** How much longer than the teardown's own bound a process that has decided its outcome may live. */
export const COMMAND_LINE_RUN_FINISH_MARGIN_MS = 30 * 1000;

/**
 * How long a failure handed to a run may take to reach an exit before the process is simply ended.
 *
 * Longer than any teardown can be (ten seconds plus a checkpoint budget of at most two minutes) and
 * replaced by the run's own, tighter bound as soon as the run gets as far as deciding its outcome.
 */
export const COMMAND_LINE_RUN_FAILURE_BACKSTOP_MS = 3 * 60 * 1000;

/** Exit 4, `studio-failed`, which the two families number alike. */
const STUDIO_FAILED_EXIT_CODE = COMMAND_LINE_CHECK_EXIT_CODES["studio-failed"];

/** What the line asked for, as far as ending it needs to know. Read before anything else can fail. */
export interface CommandLineRunIdentity {
    kind: CommandLineRunKind;
    /** Absolute, resolved against the working directory as the runs resolve it. Null for no report. */
    reportPath: string | null;
    /** `--build-allow-unsigned`, for the report's `signing` block. Always false for a check. */
    unsignedAccepted: boolean;
}

/** Everything {@link CommandLineRunEnd} does to the world, so a test can stand in for all of it. */
export interface CommandLineRunEndHost {
    /** Standard error. `done` runs once the text has left the process, or could not. */
    writeStderr(text: string, done: () => void): void;
    /** Synchronous, because the process may be in no state to wait on anything. Throws on failure. */
    writeReport(filePath: string, content: string): void;
    exit(code: number): void;
    studioVersion(): string;
    now(): number;
    setTimer(fn: () => void, ms: number): unknown;
    clearTimer(handle: unknown): void;
}

/** The family's own line prefix: `[error] Lint: ...`. */
function sourceOf(kind: CommandLineRunKind): "Build" | "Test" | "Lint" {
    return kind === "build" ? "Build" : kind === "test" ? "Test" : "Lint";
}

/**
 * Whether this launch is a command-line run, and which one.
 *
 * The parser's own answer, so this can never disagree with `BaseApp` about whether the launch was a
 * run: `requested` is true whenever `--build`, `--test` or `--lint` appeared at all, including on a
 * line that is otherwise wrong.
 */
export function readCommandLineRunIdentity(argv: readonly string[], cwd: string): CommandLineRunIdentity | null {
    const options = parseMainCommandLine(argv);
    if (options.build.requested) {
        return {
            kind: "build",
            reportPath: options.build.reportPath ? path.resolve(cwd, options.build.reportPath) : null,
            unsignedAccepted: options.build.allowUnsigned,
        };
    }
    if (options.check.requested) {
        return {
            kind: options.check.kind ?? "lint",
            reportPath: options.check.reportPath ? path.resolve(cwd, options.check.reportPath) : null,
            unsignedAccepted: false,
        };
    }
    return null;
}

type FinishTimer = { handle: unknown; exitCode: number; decided: boolean };

export class CommandLineRunEnd {
    private readonly startedAt: number;
    private readonly idleMs: number;
    private runFinish: ((sentence: string) => Promise<void>) | null = null;
    private log: ((line: string) => void) | null = null;
    private step = "Studio to start";
    private idleTimer: unknown = null;
    private finishTimer: FinishTimer | null = null;
    private failing = false;

    constructor(
        public readonly identity: CommandLineRunIdentity,
        private readonly host: CommandLineRunEndHost,
    ) {
        this.startedAt = host.now();
        this.idleMs = COMMAND_LINE_RUN_SILENCE_MS[identity.kind] + COMMAND_LINE_RUN_WATCHDOG_MARGIN_MS;
        this.armIdle();
    }

    /**
     * Also write this ending's lines to the profile's log, once there is a profile to write it in.
     *
     * Standard error alone is not enough on Windows: whoever redirected it may buffer it, and a
     * process that exits takes a buffer with it - the log file is written as it goes.
     */
    public useLog(log: (line: string) => void): void {
        this.log = log;
    }

    /**
     * Hand every later failure to the run's own `finish`, which ends it the way its own failures
     * end: its whole log, its resolved project, the drain that puts the profile down.
     */
    public attach(finish: (sentence: string) => Promise<void>): void {
        this.runFinish = finish;
    }

    /**
     * Record what the process is waiting on next, and count it as progress.
     *
     * The step is what the watchdog names if the process stops there - so it is said as the thing
     * awaited ("the workspace window to load"), which is what an operator reading the line can go
     * and look at.
     */
    public waitingOn(step: string): void {
        this.step = step;
        this.progress();
    }

    /** The run is still saying things. Resets the watchdog; does nothing once the outcome is decided. */
    public progress(): void {
        if (this.failing || this.finishTimer?.decided) {
            return;
        }
        this.armIdle();
    }

    /**
     * The run has decided its outcome and is on its way out; `teardownMs` is how long its teardown is
     * allowed. A process still alive well past that exits with the code the run decided, rather than
     * sitting on a report that has already been written.
     *
     * The first decision stands: a failure that arrives while the teardown is running does not get
     * to turn a decided exit code into another one.
     */
    public finishing(exitCode: number, teardownMs: number): void {
        this.clearIdle();
        if (this.finishTimer?.decided) {
            return;
        }
        this.armFinish(exitCode, teardownMs + COMMAND_LINE_RUN_FINISH_MARGIN_MS, true);
    }

    /**
     * End the run on `sentence`: `studio-failed`, exit 4.
     *
     * Always returns promptly and never throws - the callers are an uncaught-exception handler and
     * an entry point that has nothing left to fall back on.
     */
    public fail(text: string): void {
        // One line on a job's console, whatever the failure's own message was shaped like - a
        // parser's quotes a stretch of the file it choked on, newlines and all.
        const sentence = oneLine(text);
        if (this.failing || this.finishTimer?.decided) {
            // The first account of what went wrong is the one the report and the job's output carry,
            // and very often the second is the same failure arriving by another route (a startup that
            // failed both crashes and rejects). Still worth a line in the profile's log, which is
            // where somebody looks for why the first happened - but it may not restart the ending the
            // first one is already serving out.
            this.writeLog(`[error] ${sourceOf(this.identity.kind)}: a further failure while the run was already ending: ${sentence}`);
            return;
        }
        this.failing = true;
        this.clearIdle();
        // Whatever becomes of the ending below, the process is gone within this.
        this.armFinish(STUDIO_FAILED_EXIT_CODE, COMMAND_LINE_RUN_FAILURE_BACKSTOP_MS, false);

        const finish = this.runFinish;
        if (!finish) {
            this.endBeforeTheRun(sentence);
            return;
        }
        let pending: Promise<void>;
        try {
            pending = finish(sentence);
        } catch (error) {
            this.endBeforeTheRun(`${sentence} (the run could not end itself: ${describeError(error)})`);
            return;
        }
        void pending.catch(error => {
            this.endBeforeTheRun(`${sentence} (the run could not end itself: ${describeError(error)})`);
        });
    }

    /**
     * The ending for a failure no run has been attached to yet: the two lines, a report, the exit.
     *
     * Synchronous up to the exit, because the process may be halfway through failing to construct
     * itself. The only wait is for standard error to empty, which on a pipe can be asynchronous and
     * is exactly where the outcome line would otherwise be lost.
     */
    private endBeforeTheRun(sentence: string): void {
        const exitCode = STUDIO_FAILED_EXIT_CODE;
        const lines: CommandLineRunLogLine[] = [
            { timestamp: this.host.now(), level: "error", source: sourceOf(this.identity.kind), message: sentence },
            {
                timestamp: this.host.now(),
                level: "error",
                source: sourceOf(this.identity.kind),
                message: `studio-failed (exit ${exitCode})`,
            },
        ];
        const text = lines.map(line => `[${line.level}] ${line.source}: ${line.message}`);
        for (const line of text) {
            this.writeLog(line);
        }
        this.writeEarlyReport(sentence, exitCode, lines);
        let exited = false;
        const exit = () => {
            if (exited) {
                return;
            }
            exited = true;
            this.host.exit(exitCode);
        };
        try {
            this.host.writeStderr(`${text.join("\n")}\n`, exit);
        } catch {
            exit();
            return;
        }
        // A stream that never calls back must not keep the process alive for the backstop's minutes.
        this.host.setTimer(exit, 2000);
    }

    /**
     * A report of the family's own shape for a run that got nowhere: nothing resolved, nothing
     * built, nothing checked - which is what every absent field says - and the one sentence.
     */
    private writeEarlyReport(sentence: string, exitCode: number, log: CommandLineRunLogLine[]): void {
        const reportPath = this.identity.reportPath;
        if (!reportPath) {
            return;
        }
        const finishedAt = this.host.now();
        let studioVersion = "0.0.0";
        try {
            studioVersion = this.host.studioVersion();
        } catch {
            // The version is a courtesy; the report is the point.
        }
        const common = {
            exitCode,
            studioVersion,
            project: {},
            startedAt: this.startedAt,
            finishedAt,
            durationMs: finishedAt - this.startedAt,
            plugins: [],
            error: sentence,
            log,
        };
        const report: CommandLineBuildReport | CommandLineCheckReport = this.identity.kind === "build"
            ? {
                schema: COMMAND_LINE_BUILD_REPORT_SCHEMA,
                result: "studio-failed",
                ...common,
                signing: { signable: false, signed: false, unsignedAccepted: this.identity.unsignedAccepted },
                experimental: { state: "off", conditions: [], requestedConditions: [], unknownConditionFlags: [] },
                findings: [],
                artifacts: [],
            }
            : {
                schema: COMMAND_LINE_CHECK_REPORT_SCHEMA,
                check: this.identity.kind,
                result: "studio-failed",
                ...common,
            };
        try {
            this.host.writeReport(reportPath, `${JSON.stringify(report, null, 2)}\n`);
        } catch (error) {
            this.writeLog(`[error] could not write the report to ${reportPath}: ${describeError(error)}`);
            try {
                this.host.writeStderr(`[error] could not write the report to ${reportPath}: ${describeError(error)}\n`, () => undefined);
            } catch {
                // Nothing left to tell.
            }
        }
    }

    /** One line of this ending's own, on standard error and in the profile's log. */
    private print(level: "error" | "warning", message: string): void {
        const line = `[${level}] ${sourceOf(this.identity.kind)}: ${message}`;
        this.writeLog(line);
        try {
            this.host.writeStderr(`${line}\n`, () => undefined);
        } catch {
            // Nothing left to tell.
        }
    }

    private writeLog(line: string): void {
        try {
            this.log?.(line);
        } catch {
            // A log that cannot be written is not a reason to stop ending the run.
        }
    }

    private armIdle(): void {
        this.clearIdle();
        this.idleTimer = this.host.setTimer(() => {
            this.idleTimer = null;
            const minutes = Math.round(this.idleMs / 60000);
            this.fail(`Studio made no progress for ${minutes} minutes while it was waiting for ${this.step}, so the run was abandoned.`);
        }, this.idleMs);
    }

    private clearIdle(): void {
        if (this.idleTimer !== null) {
            this.host.clearTimer(this.idleTimer);
            this.idleTimer = null;
        }
    }

    private armFinish(exitCode: number, ms: number, decided: boolean): void {
        if (this.finishTimer) {
            this.host.clearTimer(this.finishTimer.handle);
        }
        const handle = this.host.setTimer(() => {
            const seconds = Math.round(ms / 1000);
            this.print(
                "error",
                `Studio had still not exited ${seconds} s after the run ${decided ? "decided its outcome" : "began to end"}`
                    + ` (it was waiting for ${this.step}), so it exits now with ${exitCode}.`,
            );
            this.host.exit(exitCode);
        }, ms);
        this.finishTimer = { handle, exitCode, decided };
    }
}

/** The ending this process installed, if it is a command-line run. */
let installed: CommandLineRunEnd | null = null;

/**
 * Called once, by the entry point, before anything that could fail. Returns null for a launch that
 * is not a command-line run - every launch with a person in front of it.
 */
export function installCommandLineRunEnd(
    argv: readonly string[],
    host: CommandLineRunEndHost,
    cwd: string = process.cwd(),
): CommandLineRunEnd | null {
    const identity = readCommandLineRunIdentity(argv, cwd);
    installed = identity ? new CommandLineRunEnd(identity, host) : null;
    return installed;
}

/** The ending this process installed, or null when this launch is not a command-line run. */
export function getCommandLineRunEnd(): CommandLineRunEnd | null {
    return installed;
}

/**
 * The funnel: in a command-line run, end the run on `sentence` - `studio-failed`, exit 4 - and
 * return true. Anywhere else return false, and the caller does what it does for a person.
 *
 * `sentence` is what the person would have been shown, as one sentence an operator can act on.
 */
export function endCommandLineRunOnFailure(sentence: string): boolean {
    if (!installed) {
        return false;
    }
    installed.fail(sentence);
    return true;
}

/**
 * What a run says when another Studio already owns its profile.
 *
 * Electron keys the single-instance lock on the profile directory, so the way out is always the same
 * flag - the family's own `--*-user-data-dir`.
 */
export function describeProfileInUse(kind: CommandLineRunKind): string {
    const what = kind === "build" ? "this build" : "this check";
    return `Another Studio is already running on this profile, so ${what} was not started.`
        + ` Pass --${kind}-user-data-dir to give it a profile of its own.`;
}

/**
 * What a run says about a fatal error in the main process: the first line of it - the rest is a
 * stack trace, which belongs in the log this points at rather than on a job's console.
 */
export function describeFatalErrorForCommandLine(message: string, logsDir: string | null): string {
    const headline = message.split("\n", 1)[0]?.trim().replace(/\.+$/, "") || "an unknown error";
    const where = logsDir ? ` The full error is in ${path.join(logsDir, "main.log")}.` : "";
    return `Studio stopped on an internal error: ${headline}.${where}`;
}

/** Test seam: forget the installed ending. */
export function resetCommandLineRunEndForTests(): void {
    installed = null;
}

/**
 * The real world, for the entry point.
 *
 * The version is read from Studio's own `package.json` beside the app path, as `BaseApp` reads it,
 * because this may run before `BaseApp` has - and falls back to what Electron reports.
 */
export function createProcessRunEndHost(electronApp: Electron.App): CommandLineRunEndHost {
    return {
        writeStderr: (text, done) => {
            try {
                process.stderr.write(text, () => done());
            } catch {
                done();
            }
        },
        // Unpatched, as the runs write theirs: the report goes wherever the line said, which is the
        // operator's folder rather than Studio's own archive.
        writeReport: (filePath, content) => {
            unpatchedFs.mkdirSync(path.dirname(filePath), { recursive: true });
            unpatchedFs.writeFileSync(filePath, content, "utf8");
        },
        exit: code => electronApp.exit(code),
        // The patched `fs` here, deliberately: in a packaged Studio this file is inside app.asar. The
        // folder is `BaseApp.getAppPath`'s: the archive when packaged, the checkout two levels above
        // `dist/main` otherwise.
        studioVersion: () => {
            try {
                const appDir = electronApp.isPackaged
                    ? electronApp.getAppPath()
                    : path.resolve(electronApp.getAppPath(), "..", "..");
                const pkg = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"));
                if (typeof pkg?.version === "string") {
                    return pkg.version;
                }
            } catch {
                // Fall through to Electron's own answer.
            }
            return electronApp.getVersion();
        },
        now: () => Date.now(),
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
}

function oneLine(text: string): string {
    return text.split(/\s*\r?\n\s*/).filter(Boolean).join(" ");
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
