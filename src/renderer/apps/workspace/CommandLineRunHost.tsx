import { useEffect } from "react";
import { DEFAULT_LOCALE } from "@shared/i18n";
import { commandLinePluginFlag, type CommandLineRunJob } from "@shared/types/commandLineRun";
import type { DevModeConsoleLogLevel } from "@shared/types/devMode";
import { runCommandLineBuild } from "@/lib/workspace/build/runCommandLineBuild";
import { guardUnattendedWindow } from "@/lib/workspace/commandLine/unattendedWindowGuards";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import { runCommandLineLint } from "@/lib/lint/runCommandLineLint";
import { listCommandLineTests, runCommandLineTest } from "@/lib/testing/runCommandLineTest";
import { startCommandLinePlugins } from "@/lib/plugins/commandLinePlugins";
import { getInterface } from "@/lib/app/bridge";
import { i18nStore } from "@/lib/i18n/store";
import { useWorkspace } from "./context";

/**
 * What a workspace opened by `--build`, `--test` or `--lint` renders instead of the editor.
 *
 * Nothing. The services are up by the time this mounts, and the job needs them and the project's
 * plugins - nothing else. The shell, the tabs and the built-in modules are not mounted at all. That
 * is not an optimization - `useUpdateOffer` and `useRecoveryOffer` open dialogs, and a dialog in a
 * window nobody can see is a run that never ends.
 *
 * The plugins are started here, before the job, the way the editor starts them, including any the
 * line switched on for this run - see `commandLinePlugins.ts`. Without them a project that uses a
 * plugin's nodes reads as full of unknown ones, and a sweep that passes in the Lint tab fails from
 * the command line.
 *
 * The three jobs differ only in which function is called. Everything around that - the latch, the
 * plugins, the refusal of anything that would ask a question, the failure report, the window that
 * renders nothing - is the same because the launch on the other end is waiting for the same one
 * event either way.
 */
export function CommandLineRunHost() {
    const { context, commandLineRun, recovery } = useWorkspace();

    useEffect(() => {
        if (!context || !commandLineRun) {
            return;
        }
        // Module-level rather than a ref: React runs mount effects twice in development, and the
        // second run of this one would start a second run of the same job. None of the three is
        // idempotent - a build writes artifacts, a test launches a game - so the latch has to
        // outlive the component instance that the double-invoke throws away.
        if (started) {
            return;
        }
        started = true;
        void runJob(context, commandLineRun, recovery).catch(error => {
            reportFinished(error instanceof Error ? error.message : String(error));
        });
    }, [context, commandLineRun, recovery]);

    return null;
}

let started = false;

async function runJob(context: WorkspaceContext, job: CommandLineRunJob, recovery: boolean): Promise<void> {
    // Before anything writes a line, plugins included: the run states its language rather than
    // inheriting the machine's (see `runCommandLineBuild`), and each job pins it again for itself.
    i18nStore.setLocale(DEFAULT_LOCALE);
    guardUnattendedWindow(context, message => reportFinished(message, "environment"));

    // A recovery window loads no plugins by construction, so a job run in one would answer about a
    // project with part of itself missing. Nothing opens a command-line run into recovery today;
    // this is what it would say if something did.
    if (recovery) {
        reportFinished("This project opened in recovery mode, which loads no plugins and runs nothing from the command line.", "environment");
        return;
    }

    const plugins = await startCommandLinePlugins(context, log, {
        unmetLevel: job.kind === "test-list" ? "warning" : "error",
        named: job.plugins,
        flag: commandLinePluginFlag(job.kind),
    });
    // The listing answers what this Studio and this profile have, and a plugin the project needs but
    // cannot have is part of that answer - so it is logged and the listing still printed. Every
    // other job answers about the project, which here is missing a piece of itself.
    if (!plugins.ok && job.kind !== "test-list") {
        reportFinished(plugins.error, "environment");
        return;
    }

    switch (job.kind) {
        case "build":
            return runCommandLineBuild(context, job.request);
        case "test":
            return runCommandLineTest(context, job.testId, job.parameters);
        case "test-list":
            return listCommandLineTests(context);
        default:
            return runCommandLineLint(context);
    }
}

function log(level: DevModeConsoleLogLevel, message: string): void {
    getInterface().workspace.reportCommandLineRun({
        kind: "log",
        timestamp: Date.now(),
        level,
        source: "Plugins",
        message,
    });
}

function reportFinished(error: string, refusal?: "environment"): void {
    getInterface().workspace.reportCommandLineRun({
        kind: "finished",
        ok: false,
        error,
        ...(refusal ? { refusal } : {}),
    });
}
