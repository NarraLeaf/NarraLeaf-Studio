import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { FrameRenderer } from "./frame/renderer";
import { createFrameInspector } from "./frame/inspector";
import { createFrameFloatingToolbarItems } from "./frame/floatingToolbar";
import { createFrameLayoutSizeField } from "./frame/layoutInspector";
import { defineWidgetModule } from "../declaration";
import { FrameWidgetDeclaration } from "./frame.declaration";

export const FrameWidgetModule: UIWidgetModule = defineWidgetModule(FrameWidgetDeclaration, {
    render: (props: WidgetRendererProps) => <FrameRenderer {...props}/>,
    createInspector: createFrameInspector,
    createFloatingToolbarItems: createFrameFloatingToolbarItems,
    createLayoutSizeField: createFrameLayoutSizeField
});
