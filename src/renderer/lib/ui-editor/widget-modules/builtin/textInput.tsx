import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { TextInputRenderer } from "./textInput/renderer";
import { createTextInputInspector } from "./textInput/inspector";
import { defineWidgetModule } from "../declaration";
import { TextInputWidgetDeclaration } from "./textInput.declaration";

export const TextInputWidgetModule: UIWidgetModule = defineWidgetModule(TextInputWidgetDeclaration, {
    render: (props: WidgetRendererProps) => <TextInputRenderer {...props}/>,
    createInspector: createTextInputInspector
});
