import { useEffect } from "react";
import { Services } from "@/lib/workspace/services/services";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { useWorkspace } from "../../context";
import { openAssetOverviewTab } from "./openAssetOverviewTab";

/**
 * Registers the palette entry that opens the asset overview. Renders nothing.
 *
 * It lives in the shell rather than in the assets panel because the command has to be reachable
 * whether or not that panel is on screen - a page you can only find from the sidebar is not
 * globally reachable, which is the point of listing it here (mirrors {@link EditorCommands}).
 */
export function AssetOverviewCommand() {
    const { context } = useWorkspace();

    useEffect(() => {
        if (!context) {
            return;
        }
        const commandService = context.services.get<CommandService>(Services.Command);
        return commandService.register({
            id: "assets:open-overview",
            titleKey: "assets.overview.open",
            categoryKey: "workspace.shell.commandPalette.categoryView",
            run: () => openAssetOverviewTab(context),
        });
    }, [context]);

    return null;
}
