import fs from "fs/promises";
import path from "path";
import type { App } from "@/app/app";
import type { AppWindow } from "./managers/window/appWindow";
import { WindowAppType } from "@shared/types/window";
import type { RecentlyOpenedProject } from "@shared/types/state/appStateTypes";
import type { BuildPreflightCode, BuildPreflightFinding } from "@shared/types/gameBuild";
import { currentGameBuildPlatform, type GameBuildPlatform } from "@shared/types/gameBuild";
import {
    COMMAND_LINE_BUILD_EXIT_CODES,
    COMMAND_LINE_BUILD_REPORT_SCHEMA,
    type CommandLineBuildEvent,
    type CommandLineBuildLogLine,
    type CommandLineBuildOutcome,
    type CommandLineBuildReport,
    type CommandLineBuildReportExperimental,
} from "@shared/types/commandLineBuild";
import { experimentalCondition } from "@shared/types/experimental";
import type { DevModeConsoleLogLevel } from "@shared/types/devMode";
import type { BuildCommandLineOptions } from "./commandLine";
import {
    planCommandLineBuild,
    resolveCommandLineBuildExperimental,
    type CommandLineBuildPlan,
} from "./commandLineBuildPlan";
import { resolveStartupProject } from "./startupProject";
import { readProjectConfigFromDir } from "./utils/projectConfigFile";
import { readProjectAppTagsFromDir } from "./utils/appTagsFile";
import { hasAppTag, type ProjectAppTag } from "@shared/types/appTag";

/**
 * `narraleaf-studio --build <project>`: one build, no interface, an exit code.
 *
 * ## What this is, and what it deliberately is not
 *
 * It is an entry point, not a second build system. Everything that decides whether a project may
 * ship already exists and runs in the workspace - the eight checks in `BuildService` and the
 * findings `GameBuildManager.preflight` reports - and this reuses both of them where they are. A
 * check that answered differently depending on whether a person or a script started the build would
 * be worse than having no script at all; `projectDiagnostics.ts` states that for the test pipeline
 * and it is the same rule here.
 *
 * So the shape is: resolve the project, assemble one request, ask the main-process preflight what it
 * thinks, open the project's workspace **without showing it**, let the ordinary build path run, and
 * exit on what it answers. The only genuinely new things are the command line, the exit codes and
 * the report.
 *
 * ## Nothing appears on screen
 *
 * The operator may be using this machine, and a build agent has no screen at all. Four separate
 * things had to be told:
 *   - the workspace window is created with `show: false` and never focused;
 *   - a failed load does not reveal the home screen the project was opened from;
 *   - `openWhenDone` is off, so the file manager is not opened on the output folder;
 *   - the window may not put up a native dialog when its page crashes or stops answering, which
 *     would otherwise block the run on an answer nobody is there to give.
 *
 * ## Signing
 *
 * This round builds no credential path. What it does do is refuse to *quietly* produce an unsigned
 * artifact: a target that could carry a signature and has no credential configured reports an
 * `unsigned` finding, which the Build dialog shows an author before they commit and which a command
 * line has nobody to show. So the run stops unless `--build-allow-unsigned` says the caller knows.
 * A credential that *is* configured and cannot be used here is already an error finding, and the
 * pipeline throws on it besides - see `resolveSigningForBuild`.
 *
 * ## Experimental mode
 *
 * The same shape as signing, for the same reason. `--experimental --x-debuggable-build` changes what
 * comes out - no asar integrity, a runtime that will attach - and nothing about the file records it,
 * so the human traces the mode leaves elsewhere are a warning modal in the workspace and a line on
 * the build console. This run has neither reader: the notice is a renderer `Modal` mounted in
 * `WorkspaceLayout`, which a `--build` window never renders (see `CommandLineBuildGate`), and the
 * console goes into a file.
 *
 * So two things. The mode's state goes into the report as identifiers rather than being left to the
 * prose on the log - see `CommandLineBuildReportExperimental` - and a launch that asked for the mode
 * and did not get it is refused as a bad invocation instead of quietly building the other thing. The
 * reasoning for refusing is on `resolveCommandLineBuildExperimental`.
 *
 * Entering the mode from here is deliberate and not an accident of inheritance. `--build` is not
 * dev-gated, but experimental mode is packaged-gated, which is the stronger of the two for this: no
 * installed Studio can produce a build the mode changed, whatever the line says. What is left is a
 * developer reproducing a debuggable build from a script against a checkout, which is what the
 * condition is for.
 */

/** How the project named on the command line is looked up. Injected so `App` keeps its own helpers. */
export interface CommandLineBuildProjectLookup {
    resolveDirectory(candidate: string): string | null;
    recentProjects(): readonly RecentlyOpenedProject[];
    isProjectDirectory(directory: string): boolean;
}

/**
 * Findings that say "this artifact will carry no code signature".
 *
 * Warnings, because an unsigned build is a legitimate thing to make - it is what every local check
 * and every unsigned release is. They stop a *command-line* build only because the acknowledgement
 * the dialog gets by being read cannot happen here.
 */
const UNSIGNED_FINDING_CODES: readonly BuildPreflightCode[] = ["unsigned", "unsigned-android", "unsigned-ios"];

/**
 * Platforms whose package carries a signature of its own - the four `signingPreflight` can report an
 * `unsigned*` finding for.
 *
 * Linux and the web are absent deliberately. A page has nothing to sign, and Linux's signing is
 * detached GPG signatures beside the artifacts - distribution integrity, not an OS-enforced
 * signature over the binary, as `hasSigningIdentityForPlatform` sets out. The report says so in a
 * field of its own rather than reporting them as "not signed", because a build that cannot carry a
 * signature and a build that was supposed to and did not are not the same news.
 */
const SIGNABLE_PLATFORMS: readonly GameBuildPlatform[] = ["windows", "macos", "android", "ios"];

/**
 * How long the workspace may say nothing at all before the run gives up on it.
 *
 * An idle deadline rather than a total one, and reset by every line the build writes: a real build
 * of a large project takes as long as it takes - a first cross-build downloads an Electron runtime -
 * and a total deadline would cancel exactly the runs that most needed to finish. What this catches
 * is the other shape: a window that opened, said nothing, and is never going to.
 */
const WORKSPACE_SILENCE_TIMEOUT_MS = 15 * 60 * 1000;

export class CommandLineBuildRun {
    private readonly log: CommandLineBuildLogLine[] = [];
    private readonly startedAt = Date.now();
    private reportPath: string | null = null;
    private projectPath: string | null = null;
    private projectName: string | undefined;
    private plan: CommandLineBuildPlan | null = null;
    private findings: BuildPreflightFinding[] = [];
    private finished = false;
    /**
     * What the report says about experimental mode.
     *
     * Seeded with the answer for a launch that asked for nothing, so a run refused before the mode
     * is even looked at - a malformed flag, a project that resolves to nothing - still writes a
     * report whose `experimental` block is present and true.
     */
    private experimental: CommandLineBuildReportExperimental = {
        state: "off",
        conditions: [],
        requestedConditions: [],
        unknownConditionFlags: [],
    };

    constructor(
        private readonly app: App,
        private readonly lookup: CommandLineBuildProjectLookup,
    ) {}

    /**
     * Run the build the command line asked for and exit the process.
     *
     * Never returns: every path through it ends in {@link finish}. A caller that awaited it and then
     * carried on would be doing so in a process that is already on its way out.
     */
    public async run(options: BuildCommandLineOptions): Promise<void> {
        // Resolved first, so that even a line this method refuses in its next statement leaves the
        // report file the caller is going to look for.
        this.reportPath = options.reportPath ? path.resolve(process.cwd(), options.reportPath) : null;

        if (options.error) {
            return this.finish("invocation", options.error);
        }
        if (!options.selector) {
            return this.finish("invocation", "Missing --build value: expected a project path or a recent project's name");
        }

        // Before the project is even looked for. The line is a well-formed build request by this
        // point, and whether the mode it asked for can be honoured is decided by this process alone
        // - so a launch that is going to be refused for it is refused in the same second it started
        // rather than after a large project has been read off the disk.
        const experimental = resolveCommandLineBuildExperimental(
            this.app.getRequestedExperimental(),
            this.app.getExperimentalState(),
        );
        this.experimental = experimental.report;
        if (experimental.refusal) {
            return this.finish("invocation", experimental.refusal);
        }
        this.announceExperimentalMode();

        const resolution = resolveStartupProject(options.selector, this.lookup, "--build");
        if (!resolution.ok) {
            return this.finish("invocation", resolution.reason);
        }
        if (!this.lookup.isProjectDirectory(resolution.projectPath)) {
            return this.finish("invocation", `"${resolution.projectPath}" is not a NarraLeaf project folder.`);
        }
        this.projectPath = resolution.projectPath;
        this.projectName = (await readProjectConfigFromDir(resolution.projectPath).catch(() => null))?.name;

        const planned = planCommandLineBuild({
            options,
            projectPath: resolution.projectPath,
            hostPlatform: currentGameBuildPlatform(),
            hostArch: process.arch,
            workingDirectory: process.cwd(),
        });
        if (!planned.ok) {
            return this.finish("invocation", planned.reason);
        }
        this.plan = planned.plan;

        const unknownVariant = await this.refuseUnknownVariant(planned.plan.variantId);
        if (unknownVariant) {
            return this.finish("invocation", unknownVariant);
        }

        this.emit("info", `building ${this.projectName ?? path.basename(resolution.projectPath)}`
            + ` as variant "${planned.plan.variantId}"`
            + ` for ${planned.plan.platform} (${planned.plan.format}${planned.plan.arch ? `, ${planned.plan.arch}` : ""})`);
        this.emit("info", `output folder: ${planned.plan.outputDir}`);

        const refusal = await this.runPreflight(planned.plan);
        if (refusal) {
            return this.finish(refusal.outcome, refusal.reason);
        }

        return this.runInWorkspace(planned.plan);
    }

    /**
     * Say on the log that this run is in experimental mode, and what it turned on.
     *
     * The first lines of the run, ahead of what is being built, because they say what *kind* of
     * thing is being built. `GameBuildManager` says something too - one line per condition that
     * reaches the packager - and the two are not the same statement: this one says the launch was in
     * the mode at all, which is the news when a condition affects a build that never gets that far.
     *
     * Warnings rather than info. A run this quiet has one reader, a job's captured output, and the
     * level is what a job filters on.
     */
    private announceExperimentalMode(): void {
        if (this.experimental.state !== "on") {
            return;
        }
        this.emit("warning", "experimental mode is on: this launch runs test conditions that are not"
            + " part of the product, and what it builds is not a product build.");
        if (this.experimental.conditions.length === 0) {
            this.emit("warning", "no experimental condition is active, so nothing about this build changes.");
            return;
        }
        for (const id of this.experimental.conditions) {
            this.emit("warning", `experimental condition ${id}: ${experimentalCondition(id).summary}`);
        }
    }

    /**
     * Refuse a `--build-variant` the project does not have, before anything is opened.
     *
     * The pipeline refuses it too - `resolveBuildVariant` throws rather than falling back on the
     * release identity, which is the one way this can be wrong without anyone noticing - but it does
     * so several minutes in, after the project has been opened and its checks have run, and it
     * reports a build failure rather than a mistyped flag. Asked here as well, the same mistake
     * costs a second and exits as what it is.
     *
     * A variant file that cannot be read is not an answer, so it is left to the pipeline: refusing on
     * a read that failed would turn an unreadable file into "no such variant", which sends the caller
     * looking for the wrong thing.
     */
    private async refuseUnknownVariant(variantId: string): Promise<string | null> {
        let appTags: ProjectAppTag[];
        try {
            appTags = await readProjectAppTagsFromDir(this.projectPath!);
        } catch {
            return null;
        }
        if (hasAppTag(appTags, variantId)) {
            return null;
        }
        const known = appTags.map(tag => tag.id).join(", ");
        return `The project has no build variant "${variantId}"${known ? `. It has: ${known}.` : "."}`;
    }

    /**
     * What the main process already knows about this request before a window exists.
     *
     * The same `preflight` the Build dialog runs, which is the point: an identity, a target or a
     * credential that is wrong is wrong whoever asked, and answering it here means a bad line costs
     * a second rather than the minute it takes to open a large project.
     *
     * Returns what to stop with, or null to go on. Every finding is logged either way - a warning an
     * author would have read in the dialog is a warning the log has to carry.
     */
    private async runPreflight(
        plan: CommandLineBuildPlan,
    ): Promise<{ outcome: CommandLineBuildOutcome; reason: string } | null> {
        const projectPath = this.projectPath!;
        try {
            this.findings = await this.app.getGameBuildManager().preflight(projectPath, plan.request);
        } catch (error) {
            // A preflight that cannot run has answered nothing, and this is the one caller with no
            // author to overrule it. Studio malfunctioning rather than the project being wrong, so
            // it is reported as such rather than as a refusal the project could act on.
            return {
                outcome: "studio-failed",
                reason: `The build checks could not run: ${describeError(error)}`,
            };
        }

        for (const finding of this.findings) {
            this.emit(finding.severity === "error" ? "error" : "warning", describeFinding(finding));
        }

        const blocking = this.findings.filter(finding => finding.severity === "error");
        if (blocking.length > 0) {
            return {
                outcome: "gate-refused",
                reason: `Build stopped: ${blocking.length} ${blocking.length === 1 ? "finding" : "findings"} must be answered before this project can be built.`,
            };
        }
        if (!plan.allowUnsigned && this.findings.some(finding => UNSIGNED_FINDING_CODES.includes(finding.code))) {
            return {
                outcome: "gate-refused",
                reason: "Build stopped: this build carries no code signature. Configure a signing credential for this platform, or pass --build-allow-unsigned to accept an unsigned artifact.",
            };
        }
        return null;
    }

    /**
     * Open the project without showing it, and let the workspace run the build it always runs.
     *
     * The launcher is built and held back exactly as an ordinary startup into a project builds it,
     * so this open inherits the whole of that chain - the one-project-one-window lookup, the macOS
     * bookmark re-authorization, the retirement of the opener - without the home screen ever being
     * drawn. `background` is what keeps it that way when the load fails.
     */
    private async runInWorkspace(plan: CommandLineBuildPlan): Promise<void> {
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
                commandLineBuild: { request: plan.request },
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
                        `The workspace said nothing for ${Math.round(WORKSPACE_SILENCE_TIMEOUT_MS / 60000)} minutes, so the build was abandoned.`,
                    ));
                }, WORKSPACE_SILENCE_TIMEOUT_MS);
            };
            armDeadline();

            const token = workspace.onCommandLineBuildEvent(event => {
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
                    "The workspace window went away before the build reported a result.",
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
        event: Extract<CommandLineBuildEvent, { kind: "finished" }>,
    ): Promise<void> {
        if (event.ok) {
            for (const artifact of event.artifacts ?? []) {
                this.emit("success", `wrote ${artifact}`);
            }
            if ((event.artifacts ?? []).length === 0) {
                // The packager names no artifact for an unpacked desktop target - the output is a
                // folder it wrote into rather than a file it produced. Said out loud, because a
                // successful build whose artifact list is empty otherwise reads as one that wrote
                // nothing at all.
                this.emit("success", `wrote the output to ${event.outputDir ?? this.plan?.outputDir ?? "the output folder"}`);
            }
            return this.finish("success", null, event);
        }
        // Which half failed is not something the renderer can say - a check refuses without ever
        // reaching the main process, and a pipeline failure looks the same from up there. The
        // session does say it: no session for this project means nothing was ever compiled, so the
        // build was refused before it began.
        const started = this.app.getGameBuildManager().getStatus(this.projectPath!).status !== "idle";
        return this.finish(started ? "build-failed" : "gate-refused", event.error ?? "The build did not finish.", event);
    }

    /**
     * Write the report, say what happened, put the profile down and exit.
     *
     * The teardown is `App.drainForShutdown`, the same three steps the quit path runs, because this
     * exit skips `before-quit` entirely: `exit()` is what carries a code, and a version-control call
     * still in flight when the process ends takes the process down with it.
     */
    private async finish(
        outcome: CommandLineBuildOutcome,
        error: string | null,
        event?: Extract<CommandLineBuildEvent, { kind: "finished" }>,
    ): Promise<void> {
        if (this.finished) {
            return;
        }
        this.finished = true;
        const exitCode = COMMAND_LINE_BUILD_EXIT_CODES[outcome];
        // Unless the build has just said it. A refusing check writes its own sentence to the console
        // and the same sentence reaches this as the failure, so printing it here again reads as two
        // problems where there is one.
        if (error && this.log[this.log.length - 1]?.message !== error) {
            this.emit("error", error);
        }
        this.emit(outcome === "success" ? "success" : "error", `${outcome} (exit ${exitCode})`);

        const finishedAt = Date.now();
        const signable = this.plan !== null && SIGNABLE_PLATFORMS.includes(this.plan.platform);
        const report: CommandLineBuildReport = {
            schema: COMMAND_LINE_BUILD_REPORT_SCHEMA,
            result: outcome,
            exitCode,
            studioVersion: this.readStudioVersion(),
            project: {
                ...(this.projectPath ? { path: this.projectPath } : {}),
                ...(this.projectName ? { name: this.projectName } : {}),
            },
            ...(this.plan
                ? {
                    request: {
                        variant: this.plan.variantId,
                        platform: this.plan.platform,
                        formats: [this.plan.format],
                        ...(this.plan.arch ? { arch: this.plan.arch } : {}),
                        outputDir: this.plan.outputDir,
                    },
                }
                : {}),
            startedAt: this.startedAt,
            finishedAt,
            durationMs: finishedAt - this.startedAt,
            signing: {
                signable,
                // Only a build that ran can have carried a signature, and it carried one exactly
                // when the platform could and nothing reported that it would not.
                signed: signable
                    && outcome === "success"
                    && !this.findings.some(finding => UNSIGNED_FINDING_CODES.includes(finding.code)),
                unsignedAccepted: this.plan?.allowUnsigned ?? false,
            },
            experimental: this.experimental,
            findings: this.findings,
            artifacts: (event?.artifacts ?? []).map(artifactPath => {
                const size = event?.artifactSizes?.find(entry => entry.path === artifactPath);
                return { path: artifactPath, ...(size?.bytes === undefined ? {} : { bytes: size.bytes }) };
            }),
            error,
            log: this.log,
        };

        await this.writeReport(report);
        await this.app.drainForShutdown();
        await flushStandardOutput();
        this.app.electronApp.exit(exitCode);
    }

    private async writeReport(report: CommandLineBuildReport): Promise<void> {
        if (!this.reportPath) {
            return;
        }
        try {
            await fs.mkdir(path.dirname(this.reportPath), { recursive: true });
            await fs.writeFile(this.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
        } catch (error) {
            // Printed rather than thrown: the build's own outcome is what the exit code has to
            // carry, and losing the report must not turn a good build into a failed one.
            process.stderr.write(`[error] could not write the build report to ${this.reportPath}: ${describeError(error)}\n`);
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
        this.record({ timestamp: Date.now(), level, source: "Build", message });
    }

    /**
     * Keep a line and print it.
     *
     * Standard output carries the prose, which is what a person tailing a job reads; the report file
     * carries the same lines with their timestamps and levels intact, which is what a job archives.
     * Nothing a script needs is read off this stream - see the report - so it is free to be the
     * build's own words in the build's own language.
     */
    private record(line: CommandLineBuildLogLine): void {
        this.log.push(line);
        const source = line.source ? `${line.source}: ` : "";
        process.stdout.write(`[${line.level}] ${source}${line.message}\n`);
    }
}

/**
 * Wait for everything written to standard output to have left this process.
 *
 * Writes to a pipe are asynchronous on Windows - and a pipe is exactly what a build agent captures
 * output through - so `exit()` can end the process with the last few lines still queued. Which lines
 * those are is the worst possible sample: the outcome and the exit code are the last thing written.
 * An empty write is enough, because the callback runs behind everything already in the queue.
 *
 * Resolves rather than rejects if the stream is gone: the exit code is what carries the result, and
 * losing the log must not turn a finished build into a failed one.
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

/**
 * One line for a finding.
 *
 * The code rather than the sentence the dialog renders: the localized message lives in the renderer
 * catalogue, which the main process has no route to, and the code is the thing a log is searched
 * for anyway. The detail values are what tell two findings of the same code apart.
 */
function describeFinding(finding: BuildPreflightFinding): string {
    const detail = Object.entries(finding.detail ?? {})
        .map(([key, value]) => `${key}=${value}`)
        .join(" ");
    return `${finding.section}/${finding.code}${detail ? ` (${detail})` : ""}`;
}
