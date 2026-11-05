import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { InputHintsRenderer } from "./inputHints/renderer";
import { createInputHintsInspector } from "./inputHints/inspector";
import { defineWidgetModule } from "../declaration";
import { InputHintsWidgetDeclaration } from "./inputHints.declaration";

export const InputHintsWidgetModule: UIWidgetModule = defineWidgetModule(InputHintsWidgetDeclaration, {
    render: (props: WidgetRendererProps) => <InputHintsRenderer {...props}/>,
    createInspector: createInputHintsInspector
});
