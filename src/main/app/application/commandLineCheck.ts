import fs from "fs/promises";
import path from "path";
import type { App } from "@/app/app";
import type { AppWindow } from "./managers/window/appWindow";
import { WindowAppType } from "@shared/types/window";
import {
    COMMAND_LINE_CHECK_EXIT_CODES,
    COMMAND_LINE_CHECK_REPORT_SCHEMA,
    type CommandLineCheckOutcome,
    type CommandLineCheckReport,
    type CommandLineTestListing,
} from "@shared/types/commandLineCheck";
import type {
    CommandLineRunEvent,
    CommandLineRunJob,
    CommandLineRunLogLine,
} from "@shared/types/commandLineRun";
import type { DevModeConsoleLogLevel } from "@shared/types/devMode";
import type { CheckCommandLineOptions } from "./commandLine";
import type { CommandLineBuildProjectLookup } from "./commandLineBuild";
import { resolveStartupProject } from "./startupProject";
import { readProjectConfigFromDir } from "./utils/projectConfigFile";

/**
 * `narraleaf-studio --test <project>` and `--lint <project>`: one check, no interface, an exit code.
 *
 * The flags, the exit codes and the report are set out for an operator in `docs/command-line-checks.md`;
 * what follows is why they are what they are.
 *
 * ## What this is, and what it deliberately is not
 *
 * It is an entry point, not a second test runner and not a second linter. Both already exist and
 * run in the workspace - `TestRunService` is what the Run > Test picker starts, `LintService` is
 * what the Lint tab and the build gate run - and this reuses them where they are. A check that
 * answered differently depending on whether a person or a script started it would be worse than
 * having no script at all, which is the same sentence `commandLineBuild.ts` is written under.
 *
 * So the shape is `CommandLineBuildRun`'s shape: resolve the project, open its workspace **without
 * showing it**, let the ordinary path run, and exit on what it answers. What is new here is the
 * command line, the exit codes and the report.
 *
 * ## Why both checks are one file
 *
 * Because they differ only in the verb. Both open one project, both ask one service one question,
 * both answer with findings and a verdict, and both end in a process exiting on a code a job reads.
 * The two places they genuinely differ - which job the window is opened for, and what a failure is
 * called - are three lines each. Two files would be two copies of the window lifecycle, the idle
 * deadline, the report writer and the flush.
 *
 * ## Nothing appears on screen
 *
 * The same four things `--build` had to be told, for the same reasons, and they are told in the same
 * place: `openProject({ background: true, commandLineRun })` is what carries all of it.
 *
 * ## The profile
 *
 * `--test-user-data-dir` / `--lint-user-data-dir` give the run a profile of its own, which is what
 * lets it start at all on a machine whose owner has Studio open: Electron keys the single-instance
 * lock on that directory. Acted on long before this file - `BaseApp.setupUserDataDir` - because
 * everything else reads through it.
 *
 * Unlike a build, a check reads nothing else out of the profile: no signing vault, no packager
 * mirrors. So there is no `--test-setting` to put anything back, and there is no reason for one.
 */

/**
 * How long the workspace may say nothing at all before the run gives up on it.
 *
 * An idle deadline rather than a total one, and reset by every line the check writes: a walkthrough
 * of a long story or a sweep of a two-thousand-asset library takes as long as it takes, and a total
 * deadline would cancel exactly the runs that most needed to finish. What this catches is the other
 * shape: a window that opened, said nothing, and is never going to.
 */
const WORKSPACE_SILENCE_TIMEOUT_MS = 30 * 60 * 1000;

export class CommandLineCheckRun {
    private readonly log: CommandLineRunLogLine[] = [];
    private readonly startedAt = Date.now();
    private reportPath: string | null = null;
    private projectPath: string | null = null;
    private projectName: string | undefined;
    private check: "test" | "lint" = "lint";
    private finished = false;

    constructor(
        private readonly app: App,
        private readonly lookup: CommandLineBuildProjectLookup,
    ) {}

    /**
     * Run the check the command line asked for and exit the process.
     *
     * Never returns: every path through it ends in {@link finish}. A caller that awaited it and then
     * carried on would be doing so in a process that is already on its way out.
     */
    public async run(options: CheckCommandLineOptions): Promise<void> {
        // Resolved first, so that even a line this method refuses in its next statement leaves the
        // report file the caller is going to look for.
        this.reportPath = options.reportPath ? path.resolve(process.cwd(), options.reportPath) : null;
        this.check = options.kind ?? "lint";

        if (options.error) {
            return this.finish("invocation", options.error);
        }
        if (!options.kind) {
            return this.finish("invocation", "Missing --test or --lint: nothing said what to check");
        }
        if (!options.selector) {
            return this.finish(
                "invocation",
                `Missing --${options.kind} value: expected a project path or a recent project's name`,
            );
        }
        if (options.kind === "lint" && (options.testId !== null || options.list || options.parameters.length > 0)) {
            return this.finish("invocation", "The --test flags were given with --lint, which runs no test");
        }
        if (options.kind === "test" && !options.list && !options.testId) {
            return this.finish(
                "invocation",
                "Missing --test-id: name the test to run, or pass --test-list to see what this project's Studio has",
            );
        }

        const parameters = readTestParameters(options.parameters);
        if (!parameters.ok) {
            return this.finish("invocation", parameters.reason);
        }

        const resolution = resolveStartupProject(options.selector, this.lookup, `--${options.kind}`);
        if (!resolution.ok) {
            return this.finish("invocation", resolution.reason);
        }
        if (!this.lookup.isProjectDirectory(resolution.projectPath)) {
            return this.finish("invocation", `"${resolution.projectPath}" is not a NarraLeaf project folder.`);
        }
        this.projectPath = resolution.projectPath;
        this.projectName = (await readProjectConfigFromDir(resolution.projectPath).catch(() => null))?.name;

        const job: CommandLineRunJob = options.kind === "lint"
            ? { kind: "lint" }
            : options.list
                ? { kind: "test-list" }
                : { kind: "test", testId: options.testId!, parameters: parameters.values };

        this.emit("info", describeJob(job, this.projectName ?? path.basename(resolution.projectPath)));
        return this.runInWorkspace(job);
    }

    /**
     * Open the project without showing it, and let the workspace run the check it always runs.
     *
     * The launcher is built and held back exactly as an ordinary startup into a project builds it,
     * so this open inherits the whole of that chain without the home screen ever being drawn.
     * `background` is what keeps it that way when the load fails.
     */
    private async runInWorkspace(job: CommandLineRunJob): Promise<void> {
        const projectPath = this.projectPath!;
        let workspace: AppWindow<WindowAppType.Workspace>;
        try {
            await this.app.ensureLauncher({ deferShow: true });
            const launcher = this.app.findLauncherWindow();
            if (!launcher) {
                return this.finish("studio-failed", "Studio could not prepare a window to open the project from.");
            }
            workspace = await this.app.openProject(launcher, projectPath, {
                background: true,
                commandLineRun: job,
            });
        } catch (error) {
            return this.finish("studio-failed", `Studio could not open the project: ${describeError(error)}`);
        }

        await new Promise<void>(resolve => {
            let settled = false;
            let deadline: ReturnType<typeof setTimeout>;
            const settle = (run: () => Promise<void>) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(deadline);
                token.cancel();
                void run().then(resolve, resolve);
            };
            const armDeadline = () => {
                clearTimeout(deadline);
                deadline = setTimeout(() => {
                    settle(() => this.finish(
                        "studio-failed",
                        `The workspace said nothing for ${Math.round(WORKSPACE_SILENCE_TIMEOUT_MS / 60000)} minutes, so the run was abandoned.`,
                    ));
                }, WORKSPACE_SILENCE_TIMEOUT_MS);
            };
            armDeadline();

            const token = workspace.onCommandLineRunEvent(event => {
                armDeadline();
                if (event.kind === "log") {
                    const { kind: _kind, ...line } = event;
                    this.record(line);
                    return;
                }
                settle(() => this.finishFromWorkspace(event));
            });

            // "closed", not "close": a page process that died is `destroy()`ed rather than closed,
            // and that is exactly the case this is here to catch.
            workspace.onEvent("closed", () => {
                settle(() => this.finish(
                    "studio-failed",
                    "The workspace window went away before the check reported a result.",
                ));
            });

            workspace.onLoadResult(ok => {
                if (!ok) {
                    settle(() => this.finish(
                        "studio-failed",
                        "The workspace could not open this project. Open it in Studio to see why.",
                    ));
                }
            });
        });
    }

    /** Turn the workspace's own verdict into an outcome. */
    private async finishFromWorkspace(
        event: Extract<CommandLineRunEvent, { kind: "finished" }>,
    ): Promise<void> {
        if (event.tests) {
            this.printTestListing(event.tests);
            return this.finish("success", null, event);
        }
        if (event.ok) {
            this.emit("success", event.test
                ? `${event.test.title} passed`
                : "no blocking findings");
            return this.finish("success", null, event);
        }
        // `refusal` is the workspace saying which half went wrong. Without it the two are one
        // event, and a job would have to read English to know whether retrying is worth anything.
        const outcome: CommandLineCheckOutcome = event.refusal === "invocation"
            ? "invocation"
            : event.refusal === "unavailable"
                ? "refused"
                // A run that produced a result and did not pass is the project failing the check.
                // One that produced nothing and named no refusal is Studio failing to answer.
                : event.test || event.lint
                    ? "check-failed"
                    : "studio-failed";
        return this.finish(outcome, event.error ?? "The check did not finish.", event);
    }

    /**
     * `--test-list`, as a person reads it.
     *
     * One line per test, and `presentation` in it: the whole point of the listing is that a job on a
     * machine with no screen can see which tests open a window before it starts one. The report file
     * carries the same rows with their parameters, for a caller assembling a line from them.
     */
    private printTestListing(tests: readonly CommandLineTestListing[]): void {
        if (tests.length === 0) {
            this.emit("warning", "this project's Studio has no tests registered");
            return;
        }
        for (const test of tests) {
            const parameters = test.parameters
                .map(parameter => parameter.values
                    ? `${parameter.id}=<${parameter.values.join("|")}>`
                    : `${parameter.id}=<true|false>`)
                .join(" ");
            this.emit(test.available ? "info" : "warning", [
                test.id,
                `[${test.presentation}]`,
                `[${test.category}]`,
                test.title,
                test.available ? "" : `- unavailable: ${test.unavailableReason ?? "no reason given"}`,
                parameters ? `- parameters: ${parameters}` : "",
            ].filter(Boolean).join("  "));
        }
    }

    /**
     * Write the report, say what happened, put the profile down and exit.
     *
     * The teardown is `App.drainForShutdown`, the same three steps the quit path runs, because this
     * exit skips `before-quit` entirely: `exit()` is what carries a code, and a version-control call
     * still in flight when the process ends takes the process down with it.
     */
    private async finish(
        outcome: CommandLineCheckOutcome,
        error: string | null,
        event?: Extract<CommandLineRunEvent, { kind: "finished" }>,
    ): Promise<void> {
        if (this.finished) {
            return;
        }
        this.finished = true;
        const exitCode = COMMAND_LINE_CHECK_EXIT_CODES[outcome];
        // Unless the check has just said it, the same way the build's finish does: one problem
        // printed twice reads as two.
        if (error && this.log[this.log.length - 1]?.message !== error) {
            this.emit("error", error);
        }
        this.emit(outcome === "success" ? "success" : "error", `${outcome} (exit ${exitCode})`);

        const finishedAt = Date.now();
        const report: CommandLineCheckReport = {
            schema: COMMAND_LINE_CHECK_REPORT_SCHEMA,
            check: this.check,
            result: outcome,
            exitCode,
            studioVersion: this.readStudioVersion(),
            project: {
                ...(this.projectPath ? { path: this.projectPath } : {}),
                ...(this.projectName ? { name: this.projectName } : {}),
            },
            startedAt: this.startedAt,
            finishedAt,
            durationMs: finishedAt - this.startedAt,
            ...(event?.test ? { test: event.test } : {}),
            ...(event?.lint ? { lint: event.lint } : {}),
            ...(event?.tests ? { tests: event.tests } : {}),
            error,
            log: this.log,
        };

        await this.writeReport(report);
        await this.app.drainForShutdown();
        await flushStandardOutput();
        this.app.electronApp.exit(exitCode);
    }

    private async writeReport(report: CommandLineCheckReport): Promise<void> {
        if (!this.reportPath) {
            return;
        }
        try {
            await fs.mkdir(path.dirname(this.reportPath), { recursive: true });
            await fs.writeFile(this.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
        } catch (error) {
            // Printed rather than thrown: the check's own outcome is what the exit code has to
            // carry, and losing the report must not turn a passing project into a failing one.
            process.stderr.write(`[error] could not write the report to ${this.reportPath}: ${describeError(error)}\n`);
        }
    }

    private readStudioVersion(): string {
        try {
            return this.app.getAppInfo().version;
        } catch {
            return "0.0.0";
        }
    }

    /** A line of this entry point's own, which is on the log and on the console like any other. */
    private emit(level: DevModeConsoleLogLevel, message: string): void {
        this.record({
            timestamp: Date.now(),
            level,
            source: this.check === "test" ? "Test" : "Lint",
            message,
        });
    }

    /**
     * Keep a line and print it.
     *
     * Standard output carries the prose, which is what a person tailing a job reads; the report file
     * carries the same lines with their timestamps and levels intact, which is what a job archives.
     * Nothing a script needs is read off this stream - see the report.
     */
    private record(line: CommandLineRunLogLine): void {
        this.log.push(line);
        const source = line.source ? `${line.source}: ` : "";
        process.stdout.write(`[${line.level}] ${source}${line.message}\n`);
    }
}

/**
 * `--test-parameter id=value`, repeated, as one record.
 *
 * A repeated id is refused rather than resolved to the last one: two values for one parameter is a
 * line whose author believed something that is not true about it, and picking either silently runs
 * a test against something nobody asked for.
 */
export function readTestParameters(
    raw: readonly string[],
): { ok: true; values: Record<string, string> } | { ok: false; reason: string } {
    const values: Record<string, string> = {};
    for (const entry of raw) {
        const separator = entry.indexOf("=");
        if (separator <= 0) {
            return { ok: false, reason: `--test-parameter ${entry}: expected id=value` };
        }
        const id = entry.slice(0, separator).trim();
        if (!id) {
            return { ok: false, reason: `--test-parameter ${entry}: expected id=value` };
        }
        if (id in values) {
            return { ok: false, reason: `--test-parameter ${id} was given twice` };
        }
        values[id] = entry.slice(separator + 1);
    }
    return { ok: true, values };
}

/** The first line of the run: what is about to happen, to which project. */
function describeJob(job: CommandLineRunJob, projectName: string): string {
    switch (job.kind) {
        case "lint":
            return `linting ${projectName}`;
        case "test-list":
            return `listing the tests registered for ${projectName}`;
        case "test": {
            const parameters = Object.entries(job.parameters)
                .map(([id, value]) => `${id}=${value}`)
                .join(" ");
            return `running ${job.testId} against ${projectName}${parameters ? ` with ${parameters}` : ""}`;
        }
        default:
            return `running against ${projectName}`;
    }
}

/**
 * Wait for everything written to standard output to have left this process.
 *
 * Writes to a pipe are asynchronous on Windows - and a pipe is exactly what a build agent captures
 * output through - so `exit()` can end the process with the last few lines still queued. Which lines
 * those are is the worst possible sample: the outcome and the exit code are the last thing written.
 */
function flushStandardOutput(): Promise<void> {
    return new Promise<void>(resolve => {
        try {
            process.stdout.write("", () => resolve());
        } catch {
            resolve();
        }
    });
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
