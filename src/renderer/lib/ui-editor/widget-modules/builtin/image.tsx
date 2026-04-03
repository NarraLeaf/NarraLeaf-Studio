import { Image as ImageIcon } from "lucide-react";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { ImageRenderer } from "./image/renderer";
import { createImageInspector } from "./image/inspector";
import { defaultImageWidgetProps } from "./image/types";

export const ImageWidgetModule: UIWidgetModule = {
    type: "nl.image",
    supportsBlueprintLogic: true,
    displayName: "Image",
    icon: ImageIcon,

    createDefaultElement: () => ({
        type: "nl.image",
        name: "Image",
        layout: {
            x: 0,
            y: 0,
            width: 200,
            height: 200,
            opacity: 1,
            visible: true,
        },
        props: { ...defaultImageWidgetProps },
    }),

    render: (props: WidgetRendererProps) => <ImageRenderer {...props} />,

    createInspector: createImageInspector,
};
