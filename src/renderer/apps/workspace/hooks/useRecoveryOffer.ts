import { useEffect } from "react";
import { translate } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { VersionControlService } from "@/lib/workspace/services/core/VersionControlService";
import { NotificationType } from "@/lib/workspace/services/ui/types";
import {
    countAnomalyFiles,
    describeAnomalyFile,
    observeWorkspaceAnomalies,
    type WorkspaceAnomaly,
} from "@/lib/workspace/recovery/anomalyLog";
import { useWorkspace } from "../context";

/**
 * Notice that this project is quietly broken, and offer the author a way to look at it.
 *
 * The failures worth offering for are the ones the workspace *survived*. A project that will not
 * open already says so, on a screen with its own way into recovery mode. The dangerous case is the
 * other one: assets that came back empty because their index would not parse, a scene that opens
 * blank, a plugin that threw during load - the workspace looks fine, and the author's next move is
 * to start editing on top of it. So this fires on `degraded`, and only on `degraded`.
 *
 * One offer per session, sticky. Sticky because a five-second toast about data loss is not an offer;
 * once, because the underlying cause is almost always single and stacking one toast per unreadable
 * file would bury the workspace it is warning about.
 *
 * **Silent while a merge is open**, which is not an exception to the rule above but the rule
 * applied. Recovery mode exists for damage nobody can account for, and its first act is to freeze
 * the project so that merely opening it cannot destroy the evidence. A merge accounts for itself:
 * its conflicted files are unparseable BY CONSTRUCTION - the merge leaves all three sides in them,
 * and the merge freeze's own note says so - and the way out is to finish or abandon it, which the
 * rail is standing there offering. Recovery mode on top of that is a door leading away from the
 * only thing that ends the state the author is in, and it is the door drawn as the primary action.
 *
 * Asked of the repository rather than of the freeze, which is the difference between covering one
 * case and covering both. The merge freeze is armed while a project OPENS, so it answers for a
 * window that came back to an unfinished merge and not for the window that just made one: a sync
 * that ends in conflicts reloads the documents it rewrote without freezing, which is exactly when
 * these anomalies arrive for the first time.
 */
/**
 * Module-level rather than a ref, because the thing it must be once *per* is the window, not the
 * component. A ref is reset by any remount - React's development double-invoke is one, and the retry
 * button is another - and the notification store it would offer into is a singleton shared across
 * every one of those lives, so a per-component guard produces one identical sticky toast per mount
 * stacked on top of the last. A window is one project (see the multi-project window model), so a
 * module-level latch is exactly the right scope, and a genuinely new window gets a fresh module.
 */
let offered = false;

export function useRecoveryOffer() {
    const { context, recovery } = useWorkspace();

    useEffect(() => {
        // Nothing to offer inside the shell itself, and the error screen has its own button.
        if (!context || recovery) {
            return;
        }

        const ui = context.services.get<UIService>(Services.UI);
        const version = context.services.get<VersionControlService>(Services.VersionControl);

        return observeWorkspaceAnomalies((anomalies: readonly WorkspaceAnomaly[]) => {
            if (offered) {
                return;
            }
            const degraded = anomalies.filter(anomaly => anomaly.severity === "degraded");
            if (degraded.length === 0) {
                return;
            }
            // Claimed before the read, so two batches arriving together cannot both go on to offer;
            // handed back if the read says a merge is open, because a merge ends and a real failure
            // after it still deserves this.
            offered = true;

            void (async () => {
                if (await mergeIsOpen(version)) {
                    offered = false;
                    return;
                }
                ui.notifications.showSticky({
                    type: NotificationType.Error,
                    message: translate("workspace.recovery.offer.message"),
                    detail: describeOffer(degraded, projectRootOf(context)),
                    actions: [
                        {
                            label: translate("workspace.recovery.offer.enter"),
                            primary: true,
                            onClick: () => {
                                // The reason is the first anomaly's own text rather than a summary:
                                // it is what the recovery panel leads with, and the panel's whole
                                // contract is that it repeats what happened rather than
                                // paraphrasing it.
                                const reason = `${degraded[0].source}: ${degraded[0].raw}`;
                                void getInterface().workspace.setRecoveryMode(true, reason);
                            },
                        },
                    ],
                });
            })();
        });
    }, [context, recovery]);
}

/**
 * The offer's sentence: which file, while doing what, and how many in all.
 *
 * Named, because "a file could not be read" sends the author to the recovery panel only to learn
 * which one - and the offer is the one place they read before deciding whether to keep working. The
 * file named is the first one reported (the log is newest first), which is the one whose failure
 * the rest usually follow from. Unnamed only when no record names a file at all - a plugin host that
 * would not start - and then it says so in the old words rather than inventing a name.
 */
export function describeOffer(degraded: readonly WorkspaceAnomaly[], projectRoot: string | null): string {
    const count = countAnomalyFiles(degraded);
    const named = [...degraded].reverse()
        .map(anomaly => ({ anomaly, file: describeAnomalyFile(anomaly, projectRoot) }))
        .find(entry => entry.file !== null);
    if (!named) {
        return count === 1
            ? translate("workspace.recovery.offer.detailOne")
            : translate("workspace.recovery.offer.detailMany", { count });
    }
    const params = { file: named.file!, operation: translate(named.anomaly.operationKey), count };
    return count === 1
        ? translate("workspace.recovery.offer.detailOneNamed", params)
        : translate("workspace.recovery.offer.detailManyNamed", params);
}

/** The project folder, for naming files relative to it; null when it cannot be had. */
function projectRootOf(context: { project?: { getConfig?: () => { projectPath?: string } } }): string | null {
    try {
        return context.project?.getConfig?.()?.projectPath ?? null;
    } catch {
        return null;
    }
}

/**
 * Whether this project has a merge nobody has finished.
 *
 * A failure to ask is answered as "no merge", so a host with no version control, a repository that
 * cannot be read and a project that simply has no merge all end at the same place: the offer, which
 * is what this hook exists to make. Silence is the exception here and has to be earned.
 */
async function mergeIsOpen(version: VersionControlService): Promise<boolean> {
    try {
        return (await version.getMergeState())?.inProgress === true;
    } catch {
        return false;
    }
}
