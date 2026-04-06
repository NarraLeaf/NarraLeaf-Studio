import { Image as ImageIcon } from "lucide-react";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { ImageRenderer } from "./image/renderer";
import { createImageInspector } from "./image/inspector";
import { createImageDockerBarItems } from "./image/dockerBar";

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
        props: {
            backgroundColor: "#ffffff",
            borderRadius: 0,
            borderRadiusTL: 0,
            borderRadiusTR: 0,
            borderRadiusBL: 0,
            borderRadiusBR: 0,
            borderRadiusLinked: true,
            borderColor: "#000000",
            borderWidth: 1,
            borderStyle: "solid",
            backgroundImage: "",
            backgroundFit: "cover",
            imageFill: { mode: "cover", assetId: null },
            fillType: "image",
            fillVisible: true,
            fillOpacity: 1,
            strokeVisible: true,
            strokeOpacity: 1,
            strokeAlign: "center",
            strokeSide: "all",
            borderJoin: "miter",
            cornerAdvanced: false,
        },
    }),

    render: (props: WidgetRendererProps) => <ImageRenderer {...props} />,

    createInspector: createImageInspector,

    createDockerBarItems: createImageDockerBarItems,

    createMultiSelectDockerBarItems: createImageDockerBarItems,
};
