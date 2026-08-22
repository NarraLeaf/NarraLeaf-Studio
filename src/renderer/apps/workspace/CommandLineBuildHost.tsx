import { useEffect } from "react";
import { runCommandLineBuild } from "@/lib/workspace/build/runCommandLineBuild";
import { getInterface } from "@/lib/app/bridge";
import { useWorkspace } from "./context";

/**
 * What a workspace opened by `narraleaf-studio --build` renders instead of the editor.
 *
 * Nothing. The services are up by the time this mounts, which is everything the checks and the
 * build need; the shell, the tabs, the plugins and the built-in modules are not mounted at all. That
 * is not an optimization - `useUpdateOffer` and `useRecoveryOffer` open dialogs, and a dialog in a
 * window nobody can see is a run that never ends.
 */
export function CommandLineBuildHost() {
    const { context, commandLineBuild } = useWorkspace();

    useEffect(() => {
        if (!context || !commandLineBuild) {
            return;
        }
        // Module-level rather than a ref: React runs mount effects twice in development, and the
        // second run of this one would start a second build of the same project. A build is not
        // idempotent - it writes artifacts - so the latch has to outlive the component instance
        // that the double-invoke throws away.
        if (started) {
            return;
        }
        started = true;
        void runCommandLineBuild(context, commandLineBuild).catch(error => {
            getInterface().workspace.reportCommandLineBuild({
                kind: "finished",
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }, [context, commandLineBuild]);

    return null;
}

let started = false;
