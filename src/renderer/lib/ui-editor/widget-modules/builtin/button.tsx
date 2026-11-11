import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { ButtonRenderer } from "./button/renderer";
import { createButtonInspector } from "./button/inspector";
import { createButtonDockerBarItems } from "./button/dockerBar";
import { defineWidgetModule } from "../declaration";
import { ButtonWidgetDeclaration } from "./button.declaration";

export const ButtonWidgetModule: UIWidgetModule = defineWidgetModule(ButtonWidgetDeclaration, {
    render: (props: WidgetRendererProps) => <ButtonRenderer {...props}/>,
    createInspector: createButtonInspector,
    createDockerBarItems: createButtonDockerBarItems,
    createMultiSelectDockerBarItems: createButtonDockerBarItems
});
