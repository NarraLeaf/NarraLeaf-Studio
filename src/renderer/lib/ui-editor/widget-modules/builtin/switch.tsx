import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { SwitchRenderer } from "./switch/renderer";
import { createSwitchInspector } from "./switch/inspector";
import { createSwitchDockerBarItems } from "./switch/dockerBar";
import { defineWidgetModule } from "../declaration";
import { SwitchWidgetDeclaration } from "./switch.declaration";

export const SwitchWidgetModule: UIWidgetModule = defineWidgetModule(SwitchWidgetDeclaration, {
    render: (props: WidgetRendererProps) => <SwitchRenderer {...props}/>,
    createInspector: createSwitchInspector,
    createDockerBarItems: createSwitchDockerBarItems,
    // Deliberately empty rather than absent. The bar falls back to `createDockerBarItems` for a
    // module with no multi-select variant, and `wrapMultiSelectItem` builds the aggregated button
    // from the FIRST selected element - so a mixed selection would show one switch's state on a
    // button that inverts all of them. `nl.video` removes its transport the same way.
    createMultiSelectDockerBarItems: () => []
});
