import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { ImageRenderer } from "./image/renderer";
import { createImageInspector } from "./image/inspector";
import { createImageDockerBarItems } from "./image/dockerBar";
import { defineWidgetModule } from "../declaration";
import { ImageWidgetDeclaration } from "./image.declaration";

export const ImageWidgetModule: UIWidgetModule = defineWidgetModule(ImageWidgetDeclaration, {
    render: (props: WidgetRendererProps) => <ImageRenderer {...props}/>,
    createInspector: createImageInspector,
    createDockerBarItems: createImageDockerBarItems,
    createMultiSelectDockerBarItems: createImageDockerBarItems
});
