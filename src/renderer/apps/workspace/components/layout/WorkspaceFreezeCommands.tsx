import { useEffect } from "react";
import { Services } from "@/lib/workspace/services/services";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { WorkspaceFreezeService } from "@/lib/workspace/services/core/WorkspaceFreezeService";
import { NotificationType } from "@/lib/workspace/services/ui/types";
import { translate } from "@/lib/i18n";
import { useWorkspace } from "../../context";

/**
 * The way into and out of the frozen workspace, until the version rail exists.
 *
 * Not scaffolding: the rail will drive the same {@link WorkspaceFreezeService}, and a milestone
 * whose only observable behaviour is "some writes no longer happen" cannot be accepted - or caught
 * going wrong - without a way for a person to turn it on.
 *
 * Two registrations rather than one toggle, because a palette entry is read before it is run: the
 * author searching for "freeze" needs the list to tell them which state they are in. `when` runs on
 * every keystroke in the palette, so both read the latch live rather than holding React state.
 */
export function WorkspaceFreezeCommands() {
    const { context } = useWorkspace();

    useEffect(() => {
        if (!context) {
            return;
        }
        const commandService = context.services.get<CommandService>(Services.Command);
        const freezeService = context.services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze);
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
                when: () => freezeService.isFrozen(),
                run: () => {
                    freezeService.thaw();
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
