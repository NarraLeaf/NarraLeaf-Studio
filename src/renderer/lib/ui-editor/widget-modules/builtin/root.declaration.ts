import { LayoutTemplate } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { translate } from "@/lib/i18n";
import type { UIWidgetDeclaration } from "../types";

export const RootWidgetDeclaration: UIWidgetDeclaration = {
    type: "nl.root",
    logicApi: getWidgetLogicApi("nl.root"),
    get displayName() {
        return translate("widgets.defaults.root.name");
    },
    icon: LayoutTemplate,
    createDefaultElement: () => ({
        type: "nl.root",
        name: translate("widgets.defaults.root.name"),
        layout: {
            x: 0,
            y: 0,
            width: 1280,
            height: 720,
            visible: true,
            opacity: 1,
        },
    })
};
