import { useEffect } from "react";
import { runCommandLineBuild } from "@/lib/workspace/build/runCommandLineBuild";
import { runCommandLineLint } from "@/lib/lint/runCommandLineLint";
import { listCommandLineTests, runCommandLineTest } from "@/lib/testing/runCommandLineTest";
import { getInterface } from "@/lib/app/bridge";
import { useWorkspace } from "./context";

/**
 * What a workspace opened by `--build`, `--test` or `--lint` renders instead of the editor.
 *
 * Nothing. The services are up by the time this mounts, which is everything the checks, the build
 * and the tests need; the shell, the tabs, the plugins and the built-in modules are not mounted at
 * all. That is not an optimization - `useUpdateOffer` and `useRecoveryOffer` open dialogs, and a
 * dialog in a window nobody can see is a run that never ends.
 *
 * The three jobs differ only in which function is called. Everything around that - the latch, the
 * failure report, the window that renders nothing - is the same because the launch on the other end
 * is waiting for the same one event either way.
 */
export function CommandLineRunHost() {
    const { context, commandLineRun } = useWorkspace();

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
        const job = commandLineRun;
        const run = job.kind === "build" ? runCommandLineBuild(context, job.request)
            : job.kind === "test" ? runCommandLineTest(context, job.testId, job.parameters)
                : job.kind === "test-list" ? listCommandLineTests(context)
                    : runCommandLineLint(context);
        void run.catch(error => {
            getInterface().workspace.reportCommandLineRun({
                kind: "finished",
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }, [context, commandLineRun]);

    return null;
}

let started = false;
