import { Network } from "lucide-react";
import { translate } from "@/lib/i18n";
import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { BlueprintWallTab } from "./BlueprintWallTab";
import { BLUEPRINT_WALL_TAB_ID } from "./blueprintWallTabId";

export function createBlueprintWallTab(): EditorTabDefinition {
    return {
        id: BLUEPRINT_WALL_TAB_ID,
        title: translate("blueprint.overview.title"),
        icon: <Network className="w-4 h-4" />,
        component: BlueprintWallTab,
        closable: true,
    };
}

/** Open the Blueprint Overview, or focus it if it is already open. */
export function openBlueprintWallTab(ctx: WorkspaceContext): void {
    ctx.services.get<UIService>(Services.UI).editor.open(createBlueprintWallTab());
}
