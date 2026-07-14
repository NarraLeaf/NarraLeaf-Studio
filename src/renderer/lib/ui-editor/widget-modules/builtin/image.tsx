import { Image as ImageIcon } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { createInitialImageAppearanceFromProps } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { ImageRenderer } from "./image/renderer";
import { createImageInspector } from "./image/inspector";
import { createImageDockerBarItems } from "./image/dockerBar";

export const ImageWidgetModule: UIWidgetModule = {
    type: "nl.image",
    logicApi: getWidgetLogicApi("nl.image"),
    get displayName() {
        return translate("widgets.defaults.image.name");
    },
    icon: ImageIcon,

    createDefaultElement: () => {
        const props = {
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
            imageFlipX: false,
            imageFlipY: false,
            fillType: "image",
            fillVisible: true,
            fillOpacity: 1,
            strokeVisible: true,
            strokeOpacity: 1,
            strokeAlign: "center",
            strokeSide: "all",
            borderJoin: "miter",
            cornerAdvanced: false,

            transformOffsetX: 0,
            transformOffsetY: 0,
            transformScale: 1,
            transformRotation: 0,
            transformOpacity: 1,
        };
        return {
            type: "nl.image" as const,
            name: translate("widgets.defaults.image.name"),
            layout: {
                x: 0,
                y: 0,
                width: 200,
                height: 200,
                opacity: 1,
                visible: true,
            },
            props: {
                ...props,
                appearance: createInitialImageAppearanceFromProps(props),
            },
        };
    },

    render: (props: WidgetRendererProps) => <ImageRenderer {...props} />,

    createInspector: createImageInspector,

    createDockerBarItems: createImageDockerBarItems,

    createMultiSelectDockerBarItems: createImageDockerBarItems,
};
