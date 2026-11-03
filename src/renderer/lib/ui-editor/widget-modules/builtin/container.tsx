import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { ContainerRenderer } from "./container/renderer";
import { createContainerInspector } from "./container/inspector";
import { createContainerDockerBarItems } from "./container/dockerBar";
import { defineWidgetModule } from "../declaration";
import { ContainerWidgetDeclaration } from "./container.declaration";

export const ContainerWidgetModule: UIWidgetModule = defineWidgetModule(ContainerWidgetDeclaration, {
    render: (props: WidgetRendererProps) => <ContainerRenderer {...props}/>,
    createInspector: createContainerInspector,
    createDockerBarItems: createContainerDockerBarItems,
    createMultiSelectDockerBarItems: createContainerDockerBarItems
});
