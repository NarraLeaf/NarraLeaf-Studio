import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { useWorkspace } from "../../context";
import { useKeybinding } from "../../hooks";
import { reopenLastClosedTab } from "../../session/workspaceClosedTabsStore";

/**
 * Window-wide "reopen closed tab" shortcut. Lives beside the quick switch in
 * the workspace shell rather than in EditorGroup: registering it per group
 * would stack duplicate registrations of the same id, and losing the last
 * group (all tabs closed) would take the shortcut with it — exactly when it
 * is needed most.
 */
export function EditorClosedTabsKeybinding() {
    const { context } = useWorkspace();

    useKeybinding({
        id: "workspace-reopen-closed-tab",
        key: "mod+shift+t",
        description: "Reopen the most recently closed editor tab",
        handler: () => {
            if (!context) {
                return;
            }
            const uiService = context.services.get<UIService>(Services.UI);
            reopenLastClosedTab(context, uiService);
        },
        allowInEditable: true,
    });

    return null;
}
