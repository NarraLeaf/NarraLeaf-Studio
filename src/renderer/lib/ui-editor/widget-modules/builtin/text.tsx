import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { TextRenderer } from "./text/renderer";
import { createTextInspector } from "./text/inspector";
import { createTextDockerBarItems } from "./text/dockerBar";
import { defineWidgetModule } from "../declaration";
import { TextWidgetDeclaration } from "./text.declaration";

export const TextWidgetModule: UIWidgetModule = defineWidgetModule(TextWidgetDeclaration, {
    render: (props: WidgetRendererProps) => <TextRenderer {...props}/>,
    createInspector: createTextInspector,
    createDockerBarItems: createTextDockerBarItems,
    createMultiSelectDockerBarItems: createTextDockerBarItems
});
