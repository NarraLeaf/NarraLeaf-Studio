import React, { type ReactElement } from "react";
import { LayoutTemplate } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";

/**
 * Internal surface root: not user-insertable; registered so runtime and tooling resolve `nl.root`.
 */
export const RootWidgetModule: UIWidgetModule = {
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
    }),

    render: ({ children }: WidgetRendererProps): ReactElement | null => <>{children}</>,
};
