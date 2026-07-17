import { Package } from "lucide-react";
import { translate } from "@/lib/i18n";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/ui";
import { PanelPosition } from "../../registry/types";
import type { PanelModule } from "../types";
import { ProjectPanel, type ProjectPanelPayload } from "./ProjectPanel";

export const PROJECT_PANEL_ID = "narraleaf-studio:project";

/**
 * Open the project panel, optionally jumping straight to a sub-page. Lets other
 * surfaces (the build dialog's icon rows) hand the user off to the setting they
 * need to change instead of describing where to find it.
 */
export function openProjectPanel(workspace: WorkspaceContext, payload: ProjectPanelPayload = {}): void {
    const uiService = workspace.services.get<UIService>(Services.UI);
    uiService.panels.updatePayload(PROJECT_PANEL_ID, payload);
    uiService.panels.show(PROJECT_PANEL_ID);
}

export const projectPanelModule: PanelModule<ProjectPanelPayload> = {
    metadata: {
        id: PROJECT_PANEL_ID,
        // titleKey drives the reactive heading; the title getter stays as a plain-string fallback
        // for any consumer that reads `title` directly (it is captured once at registration).
        titleKey: "placeholders.moduleTitles.project",
        get title() {
            return translate("placeholders.moduleTitles.project");
        },
        icon: <Package className="w-4 h-4" />,
        position: PanelPosition.Left,
        defaultVisible: false,
        order: -20,
    },
    component: ProjectPanel,
};

export { ProjectPanel };
export type { ProjectPanelPayload };
