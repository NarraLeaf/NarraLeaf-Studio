import { SlidersHorizontal } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { defaultContainerWidgetProps } from "@shared/types/ui-editor/container";
import { defaultSliderWidgetProps, sliderValueToNormalized } from "@shared/types/ui-editor/slider";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { createInitialContainerAppearance } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { SliderRenderer } from "./slider/renderer";
import { createSliderInspector } from "./slider/inspector";

function createSliderPartProps(kind: "track" | "handle"): Record<string, unknown> {
    const props = {
        ...defaultContainerWidgetProps,
        layoutKind: "free" as const,
        clipContent: true,
        backgroundColor: kind === "track" ? "#64748b" : "#f8fafc",
        fillType: "color" as const,
        fillVisible: true,
        fillOpacity: 1,
        borderRadius: 999,
        borderRadiusTL: 999,
        borderRadiusTR: 999,
        borderRadiusBL: 999,
        borderRadiusBR: 999,
        borderRadiusLinked: true,
        borderColor: kind === "track" ? "#64748b" : "#0f172a",
        borderWidth: kind === "track" ? 0 : 1,
        borderStyle: "solid",
        strokeVisible: kind === "handle",
        strokeOpacity: kind === "handle" ? 0.2 : 0,
        strokeAlign: "inside" as const,
        strokeSide: "all",
        borderJoin: "round" as const,
    };
    return {
        ...props,
        appearance: createInitialContainerAppearance(props),
    };
}

function createSliderPart(input: {
    id: string;
    parentId: string;
    name: string;
    slot: "track" | "handle";
    layout: UIElement["layout"];
}): UIElement {
    return {
        id: input.id,
        type: "nl.container",
        name: input.name,
        parentId: input.parentId,
        childrenIds: [],
        layout: input.layout,
        props: createSliderPartProps(input.slot),
        extra: { sliderSlot: input.slot },
    };
}

export const SliderWidgetModule: UIWidgetModule = {
    type: "nl.slider",
    logicApi: getWidgetLogicApi("nl.slider"),
    displayName: "Slider",
    icon: SlidersHorizontal,

    createDefaultElement: () => ({
        type: "nl.slider",
        name: "Slider",
        layout: {
            x: 0,
            y: 0,
            width: 260,
            height: 40,
            opacity: 1,
            visible: true,
        },
        props: { ...defaultSliderWidgetProps },
    }),

    createDefaultChildElements: ({ element, generateId }) => {
        const trackId = generateId();
        const handleId = generateId();
        const width = Math.max(40, Math.abs(element.layout.width));
        const height = Math.max(24, Math.abs(element.layout.height));
        const trackLayout = {
            x: 16,
            y: Math.max(0, height / 2 - 3),
            width: Math.max(24, width - 32),
            height: 6,
            visible: true,
            opacity: 1,
        };
        const handleWidth = 18;
        const handleHeight = 22;
        const normalizedValue = sliderValueToNormalized(defaultSliderWidgetProps.value, defaultSliderWidgetProps);
        const handleTravel = Math.max(0, trackLayout.width - handleWidth);
        return {
            elementPatch: {
                props: {
                    ...defaultSliderWidgetProps,
                    trackElementId: trackId,
                    handleElementId: handleId,
                },
            },
            children: [
                createSliderPart({
                    id: trackId,
                    parentId: element.id,
                    name: "Slider Track",
                    slot: "track",
                    layout: trackLayout,
                }),
                createSliderPart({
                    id: handleId,
                    parentId: element.id,
                    name: "Slider Handle",
                    slot: "handle",
                    layout: {
                        x: trackLayout.x + handleTravel * normalizedValue,
                        y: Math.max(0, height / 2 - handleHeight / 2),
                        width: handleWidth,
                        height: handleHeight,
                        visible: true,
                        opacity: 1,
                    },
                }),
            ],
        };
    },

    render: (props: WidgetRendererProps) => <SliderRenderer {...props} />,

    createInspector: createSliderInspector,
};
