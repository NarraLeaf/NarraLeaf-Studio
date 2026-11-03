import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { PuppetRenderer } from "./puppet/renderer";
import { createPuppetInspector } from "./puppet/inspector";
import { createPuppetDockerBarItems } from "./puppet/dockerBar";
import { defineWidgetModule } from "../declaration";
import { PuppetWidgetDeclaration } from "./puppet.declaration";

export const PuppetWidgetModule: UIWidgetModule = defineWidgetModule(PuppetWidgetDeclaration, {
    render: (props: WidgetRendererProps) => <PuppetRenderer {...props}/>,
    createInspector: createPuppetInspector,
    createDockerBarItems: createPuppetDockerBarItems,
    createMultiSelectDockerBarItems: createPuppetDockerBarItems
});
