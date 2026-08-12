import { useEffect } from "react";
import { Services } from "@/lib/workspace/services/services";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { WorkspaceFreezeService } from "@/lib/workspace/services/core/WorkspaceFreezeService";
import { VersionControlService } from "@/lib/workspace/services/core/VersionControlService";
import { NotificationType } from "@/lib/workspace/services/ui/types";
import { translate } from "@/lib/i18n";
import { useWorkspace } from "../../context";
import { openVcsChangesTab } from "../../modules/vcs-changes/openVcsChangesTab";
import { unavailableReasonKey } from "./versionRailModel";
import {
    isVersionRailReachable,
    openVersionRail,
    openVersionRailForCommit,
} from "./versionRailController";

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
                when: () => freezeService.getReason()?.kind === "manual" && !freezeService.isReleaseHeld(),
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
            /*
             * The four ordinary acts, which had no palette entry at all.
             *
             * Everything above is about the frozen workspace - the state an author gets INTO by
             * accident and needs a documented way out of - and that is how this list came to hold
             * only the exceptional half of the feature. Meanwhile the way to submit a version was a
             * button inside a panel reachable from two places, neither of which is where someone
             * looks when they already know what they want.
             *
             * **None of them takes a keybinding.** A command with a default shortcut registers that
             * key globally for the window, and four more global keys is not what "the palette should
             * know about commit" is worth. The palette is the whole point: it is searchable.
             */
            {
                id: "vcs:open-rail",
                titleKey: "workspace.shell.versionControl.command.openRail",
                categoryKey: "workspace.shell.commandPalette.categoryVersionControl",
                // The rail registers its bridge exactly when version control exists for this
                // project, so this is the synchronous form of the availability question a `when`
                // cannot ask any other way.
                when: () => isVersionRailReachable(),
                run: () => openVersionRail(),
            },
            {
                id: "vcs:commit",
                titleKey: "workspace.shell.versionControl.command.commit",
                categoryKey: "workspace.shell.commandPalette.categoryVersionControl",
                // The form is absent while project data is frozen (`isCommitFormPresent`), so
                // offering this then would land the author on a panel with no box in it.
                when: () => isVersionRailReachable() && !freezeService.isFrozen(),
                run: () => openVersionRailForCommit(),
            },
            {
                id: "vcs:refresh-changes",
                titleKey: "workspace.shell.versionControl.command.refreshChanges",
                categoryKey: "workspace.shell.commandPalette.categoryVersionControl",
                // Not while a past revision is on screen. A scan is not a pure read - it records
                // newly discovered directories into staged state (docs §4.17) - and "browsing
                // history has zero side effects" is the decision this feature is shaped around. The
                // rail skips the same scan in the same state, for the same reason.
                when: () => isVersionRailReachable() && freezeService.getReason()?.kind !== "revision",
                run: async () => {
                    openVersionRail();
                    await versionControl.refreshStatus();
                },
            },
            {
                id: "vcs:compare-working-tree",
                titleKey: "workspace.shell.versionControl.command.compareChanges",
                categoryKey: "workspace.shell.commandPalette.categoryVersionControl",
                when: () => isVersionRailReachable(),
                run: async () => {
                    // `getInfo` is a pure read (`repositoryStatus(scan:false, revisionOnly:true)`),
                    // so asking for the head's number here costs nothing and is what lets the tab
                    // call it `#36` rather than by hash - the way every other surface names it.
                    const info = await versionControl.getInfo();
                    openVcsChangesTab(context, {
                        mode: "working-tree",
                        headLabel: info && info.headNumber > 0 ? `#${info.headNumber}` : undefined,
                    });
                },
            },
            {
                id: "vcs:show-working-tree",
                titleKey: "workspace.shell.revisionView.leave",
                categoryKey: "workspace.shell.commandPalette.categoryVersionControl",
                // Absent, not disabled, while something is rewriting the project files: a restore
                // leaves the view itself when it finishes, so during one this entry is REDUNDANT
                // rather than refused, and an entry that offers to do what is about to happen anyway
                // is worse than no entry. The gate that makes this safe is not here, though - it is
                // `holdRelease` inside the service, because a `when` is the kind of thing the next
                // surface forgets (see WorkspaceFreezeService.holdRelease, and writeFreeze for the
                // same argument about the write boundary).
                when: () => freezeService.getReason()?.kind === "revision" && !freezeService.isReleaseHeld(),
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
