import { type ReactElement } from "react";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { defineWidgetModule } from "../declaration";
import { RootWidgetDeclaration } from "./root.declaration";

export const RootWidgetModule: UIWidgetModule = defineWidgetModule(RootWidgetDeclaration, {
    render: ({ children }: WidgetRendererProps): ReactElement | null => <>{children}</>
});
