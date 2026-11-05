import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { ListRenderer } from "./list/renderer";
import { createListInspector } from "./list/inspector";
import { createListDockerBarItems } from "./list/dockerBar";
import { defineWidgetModule } from "../declaration";
import { ListWidgetDeclaration } from "./list.declaration";

export const ListWidgetModule: UIWidgetModule = defineWidgetModule(ListWidgetDeclaration, {
    render: (props: WidgetRendererProps) => <ListRenderer {...props}/>,
    createInspector: createListInspector,
    createDockerBarItems: createListDockerBarItems,
    createMultiSelectDockerBarItems: createListDockerBarItems
});
