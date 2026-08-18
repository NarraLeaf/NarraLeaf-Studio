import { UserRound } from "lucide-react";
import { DEFAULT_UI_CHARACTER_WIDGET_PROPS, UI_CHARACTER_ELEMENT_TYPE } from "@shared/types/ui-editor/character";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { CharacterRenderer } from "./character/renderer";
import { createCharacterInspector } from "./character/inspector";

/**
 * `nl.character` — the character a frame is showing.
 *
 * Offered only on surfaces that are drawn inside a stage element, because that is the only place the
 * question "which character is this" has an answer. See `insertPalette.ts` for that filter and
 * `@shared/types/ui-editor/character` for why the widget names no artwork of its own.
 */
export const CharacterWidgetModule: UIWidgetModule = {
    type: UI_CHARACTER_ELEMENT_TYPE,
    get displayName() {
        return translate("widgets.defaults.character.name");
    },
    icon: UserRound,

    createDefaultElement: () => ({
        type: UI_CHARACTER_ELEMENT_TYPE,
        name: translate("widgets.defaults.character.name"),
        layout: {
            x: 0,
            y: 0,
            width: 240,
            height: 240,
            opacity: 1,
            visible: true,
        },
        props: {
            ...DEFAULT_UI_CHARACTER_WIDGET_PROPS,
            // A frame is usually a shape with something clipped inside it, so the widget starts as a
            // circle: the corner radius is the chrome's, which is what does the clipping.
            backgroundColor: "#00000000",
            fillType: "color",
            fillVisible: false,
            borderRadius: 120,
            borderRadiusTL: 120,
            borderRadiusTR: 120,
            borderRadiusBL: 120,
            borderRadiusBR: 120,
            borderRadiusLinked: true,
            borderWidth: 0,
            borderColor: "#000000",
            borderStyle: "solid",
            strokeVisible: false,
            strokeOpacity: 1,
            fillOpacity: 1,
        },
    }),

    render: (props: WidgetRendererProps) => <CharacterRenderer {...props} />,

    createInspector: createCharacterInspector,
};
