import { useEffect } from "react";
import { Services } from "@/lib/workspace/services/services";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { WorkspaceFreezeService } from "@/lib/workspace/services/core/WorkspaceFreezeService";
import { VersionControlService } from "@/lib/workspace/services/core/VersionControlService";
import { NotificationType } from "@/lib/workspace/services/ui/types";
import { translate } from "@/lib/i18n";
import { useWorkspace } from "../../context";
import { unavailableReasonKey } from "./versionRailModel";

/**
 * The way into and out of the frozen workspace - and into and out of a past revision - until the
 * version rail exists.
 *
 * Not scaffolding: the rail will drive the same {@link WorkspaceFreezeService}, and a milestone whose
 * only observable behaviour is "some writes no longer happen" cannot be accepted - or caught going
 * wrong - without a way for a person to turn it on.
 *
 * One registration per state rather than a toggle, because a palette entry is read before it is run:
 * the author searching for "freeze" needs the list to tell them which state they are in. `when` runs
 * on every keystroke in the palette, so all four read the latch live rather than holding React state.
 *
 * The revision entry shows the PREVIOUS revision rather than asking which one. Choosing needs a list
 * of revisions to choose from, that list is the version rail, and building a picker here would be
 * building the rail badly first. Two revisions is also exactly what the acceptance walk-through needs:
 * commit, edit, commit, look at what the scene said before.
 */
export function WorkspaceFreezeCommands() {
    const { context } = useWorkspace();

    useEffect(() => {
        if (!context) {
            return;
        }
        const commandService = context.services.get<CommandService>(Services.Command);
        const freezeService = context.services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze);
        const versionControl = context.services.get<VersionControlService>(Services.VersionControl);
        const notify = (message: string, detail: string) => {
            context.services.get<UIService>(Services.UI).notifications.show({
                type: NotificationType.Info,
                message,
                detail,
            });
        };

        return commandService.registerMany([
            {
                id: "vcs:freeze-workspace",
                titleKey: "workspace.shell.freeze.command",
                categoryKey: "workspace.shell.commandPalette.categoryVersionControl",
                when: () => !freezeService.isFrozen(),
                run: async () => {
                    await freezeService.freeze({ kind: "manual" });
                    notify(
                        translate("workspace.shell.freeze.enteredTitle"),
                        translate("workspace.shell.freeze.enteredDetail"),
                    );
                },
            },
            {
                id: "vcs:unfreeze-workspace",
                titleKey: "workspace.shell.freeze.release",
                categoryKey: "workspace.shell.commandPalette.categoryVersionControl",
                // Manual freezes only. A revision view is left by the entry below, which also has to
                // put the source away - and an author who unfroze a historical view with this one
                // would be looking at a past revision in a writable workspace.
                when: () => freezeService.getReason()?.kind === "manual",
                run: () => {
                    freezeService.thaw();
                    notify(
                        translate("workspace.shell.freeze.leftTitle"),
                        translate("workspace.shell.freeze.leftDetail"),
                    );
                },
            },
            {
                id: "vcs:show-previous-revision",
                titleKey: "workspace.shell.revisionView.showPrevious",
                categoryKey: "workspace.shell.commandPalette.categoryVersionControl",
                when: () => !freezeService.isFrozen(),
                run: async () => {
                    // Availability first, and answered in the author's own words. Every surface that
                    // can be hidden on an unsupported host IS hidden (the rail, the switcher menu, the status
                    // cell all render nothing), but a palette entry's `when` is synchronous and this
                    // answer is not, so this is the one place left where the author can ask a question
                    // the machine cannot answer. The two messages differ because their fixes do: an
                    // unsupported OS/arch is the machine, a missing or unloadable backend is the
                    // installation - see `unavailableReasonKey`.
                    const availability = await versionControl.getAvailability();
                    if (!availability.available) {
                        notify(
                            translate("workspace.shell.revisionView.failedTitle"),
                            translate(unavailableReasonKey(availability.reason)),
                        );
                        return;
                    }
                    // Two entries, newest first: the head, and the one before it. Enough to reach the
                    // behaviour without a picker, and `getHistory` is cached so opening the palette
                    // repeatedly does not re-read (nor scan - see VersionControlService).
                    const history = await versionControl.getHistory(2);
                    const previous = history[1];
                    if (!previous) {
                        notify(
                            translate("workspace.shell.revisionView.noneTitle"),
                            translate("workspace.shell.revisionView.noneDetail"),
                        );
                        return;
                    }
                    notify(
                        translate("workspace.shell.revisionView.loadingTitle"),
                        translate("workspace.shell.revisionView.loadingDetail"),
                    );
                    try {
                        // The revision NUMBER, not the hash: history entries carry no message (reading
                        // one costs a call per revision), and `#4` is the only short thing about a
                        // revision that means anything to the person looking at it.
                        await versionControl.showRevision(previous.revision, `#${previous.number}`);
                    } catch (error) {
                        notify(
                            translate("workspace.shell.revisionView.failedTitle"),
                            error instanceof Error ? error.message : String(error),
                        );
                        return;
                    }
                    notify(
                        translate("workspace.shell.revisionView.shownTitle", { revision: `#${previous.number}` }),
                        translate("workspace.shell.revisionView.shownDetail"),
                    );
                },
            },
            {
                id: "vcs:show-working-tree",
                titleKey: "workspace.shell.revisionView.leave",
                categoryKey: "workspace.shell.commandPalette.categoryVersionControl",
                when: () => freezeService.getReason()?.kind === "revision",
                run: () => {
                    versionControl.showWorkingTree();
                    notify(
                        translate("workspace.shell.freeze.leftTitle"),
                        translate("workspace.shell.freeze.leftDetail"),
                    );
                },
            },
        ]);
    }, [context]);

    return null;
}
