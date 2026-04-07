import React, { type ReactElement } from "react";
import { LayoutTemplate } from "lucide-react";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";

/**
 * Internal surface root: not user-insertable; registered so runtime and tooling resolve `nl.root`.
 */
export const RootWidgetModule: UIWidgetModule = {
    type: "nl.root",
    displayName: "Root",
    icon: LayoutTemplate,

    createDefaultElement: () => ({
        type: "nl.root",
        name: "Root",
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
