import { ToggleLeft } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { defaultSwitchWidgetProps, UI_SWITCH_ON_VARIANT_ID, type UISwitchChildSlot } from "@shared/types/ui-editor/switch";
import type { UIElement } from "@shared/types/ui-editor/document";
import { translate } from "@/lib/i18n";
import { createSwitchPartProps, resolveSwitchPartGeometry } from "./switch/helpers";
import type { UIWidgetDeclaration } from "../types";

function createSwitchPart(input: {
    id: string;
    parentId: string;
    name: string;
    slot: UISwitchChildSlot;
    travel: number;
    layout: UIElement["layout"];
}): UIElement {
    return {
        id: input.id,
        type: "nl.container",
        name: input.name,
        parentId: input.parentId,
        childrenIds: [],
        layout: input.layout,
        props: createSwitchPartProps(input.slot, input.travel),
        extra: { switchSlot: input.slot },
    };
}
export const SwitchWidgetDeclaration: UIWidgetDeclaration = {
    type: "nl.switch",
    logicApi: getWidgetLogicApi("nl.switch"),
    get displayName() {
        return translate("widgets.defaults.switch.name");
    },
    icon: ToggleLeft,
    createDefaultElement: () => ({
        type: "nl.switch",
        name: translate("widgets.defaults.switch.name"),
        layout: {
            x: 0,
            y: 0,
            width: 52,
            height: 28,
            opacity: 1,
            visible: true,
        },
        props: { ...defaultSwitchWidgetProps },
    }),
    // Its two states are the widget's own: `checked` is a property of the switch, while what on and
    // off look like belongs to the parts. Entering one here broadcasts to both of them.
    listEditorStates: () => [
        { id: null, name: translate("widgets.defaults.switch.offVariant") },
        { id: UI_SWITCH_ON_VARIANT_ID, name: translate("widgets.defaults.switch.onVariant") },
    ],
    createDefaultChildElements: ({ element, generateId }) => {
        const trackId = generateId();
        const thumbId = generateId();
        const { inset, trackW, trackH, thumbSize, travel } = resolveSwitchPartGeometry(element.layout);
        return {
            elementPatch: {
                props: {
                    ...defaultSwitchWidgetProps,
                    trackElementId: trackId,
                    thumbElementId: thumbId,
                },
            },
            children: [
                createSwitchPart({
                    id: trackId,
                    parentId: element.id,
                    name: translate("widgets.defaults.switch.track"),
                    slot: "track",
                    travel,
                    layout: {
                        x: 0,
                        y: 0,
                        width: trackW,
                        height: trackH,
                        visible: true,
                        opacity: 1,
                    },
                }),
                createSwitchPart({
                    id: thumbId,
                    parentId: element.id,
                    name: translate("widgets.defaults.switch.thumb"),
                    slot: "thumb",
                    travel,
                    // The inset is the off-state anchor: the `on` variant's transformOffsetX moves
                    // the thumb from here, so the authored layout must never be touched at runtime.
                    layout: {
                        x: inset,
                        y: inset,
                        width: thumbSize,
                        height: thumbSize,
                        visible: true,
                        opacity: 1,
                    },
                }),
            ],
        };
    }
};
