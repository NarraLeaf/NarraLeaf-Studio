import { useEffect } from "react";
import { getInterface } from "@/lib/app/bridge";
import { isMacPlatform } from "@/lib/app/platform";
import { useWorkspace } from "../context";
import { welcomeModule } from "../modules/welcome";
import { Workspace } from "@/lib/workspace/workspace";
import { UIService } from "@/lib/workspace/services/ui";
import { Services } from "@/lib/workspace/services/services";

/**
 * Listens for macOS native menu actions and dispatches
 * them to the appropriate handlers in the workspace renderer.
 * Only registers on macOS.
 */
export function useMenuActionHandler(): void {
    const { workspace } = useWorkspace();

    useEffect(() => {
        if (!isMacPlatform()) return;

        const token = getInterface().workspace.onMenuAction((action: string) => {
            void handleMenuAction(action, workspace);
        });

        return () => {
            token.cancel();
        };
    }, [workspace]);
}

async function handleMenuAction(action: string, workspace: Workspace | null): Promise<void> {
    switch (action) {
        case "new-workspace": {
            const result = await getInterface().app.launchProjectWizard({});
            if (result.success && result.data?.created) {
                await getInterface().workspace.launch(
                    { projectPath: result.data.projectPath },
                    true
                );
            }
            break;
        }
        case "open-workspace": {
            const result = await getInterface().selectFolder();
            if (!result.success || !result.data?.path) return;
            await getInterface().workspace.launch(
                { projectPath: result.data.path },
                true
            );
            break;
        }
        case "preferences": {
            await getInterface().app.launchSettings({});
            break;
        }
        case "export-project": {
            if (!workspace) break;
            const uiService = workspace.getContext().services.get<UIService>(Services.UI);
            uiService.showNotification("Choose a folder for the exported project package.", "info");
            const projectPath = workspace.getContext().project.getConfig().projectPath;
            const result = await getInterface().workspace.exportProjectPackage(projectPath);
            if (!result.success) {
                uiService.showNotification(result.error || "Failed to export project.", "error");
                return;
            }
            if (result.data.canceled) return;
            const fileCount = result.data.fileCount ?? 0;
            uiService.showNotification(`Exported project package with ${fileCount} files.`, "success");
            break;
        }
        case "close-workspace": {
            await getInterface().workspace.close();
            break;
        }
        case "open-welcome": {
            if (!workspace) break;
            const uiService = workspace.getContext().services.get<UIService>(Services.UI);
            uiService.editor.open({
                id: welcomeModule.metadata.id,
                title: welcomeModule.metadata.title,
                icon: welcomeModule.metadata.icon,
                component: welcomeModule.component as any,
                closable: welcomeModule.metadata.closable,
                modified: welcomeModule.metadata.modified,
            });
            break;
        }
        default:
            break;
    }
}
