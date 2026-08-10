import { MousePointerClick } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { ButtonRenderer } from "./button/renderer";
import { createButtonInspector } from "./button/inspector";
import { createButtonDockerBarItems } from "./button/dockerBar";
import { defaultButtonWidgetProps } from "./button/types";
import { createInitialButtonAppearance } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { formatBrandLink } from "@shared/brand/brandLink";

/**
 * The colours a *newly created* button starts with: links into the project palette, so that a fresh
 * button is already the project's colour and changing the brand changes it.
 *
 * **Deliberately here and not in `defaultButtonWidgetProps`.** That object is the read-time fallback
 * for a prop a document does not carry, which makes it the answer for every button ever made - so
 * putting links in it would repaint buttons in existing projects whose author never chose a colour.
 * Materialising them here means the link is written into the new element, and only into that one.
 *
 * `button.secondary` and `button.shadow` are absent because a new button has no row for them to land
 * on: `createInitialButtonAppearance` builds a single `default` variant with no conditional rows, and
 * `effects.effectShadow` starts null. Those two slots exist for an author who adds a hover row or a
 * shadow layer and then points it at the brand - giving every new button a hover state and a shadow
 * so the slots had somewhere to go would be changing what a button *is*, not what colour it is.
 */
const BRANDED_BUTTON_COLORS = {
    backgroundColor: formatBrandLink("button.primary"),
    borderColor: formatBrandLink("button.border"),
    color: formatBrandLink("button.text"),
} as const;

export const ButtonWidgetModule: UIWidgetModule = {
    type: "nl.button",
    logicApi: getWidgetLogicApi("nl.button"),
    get displayName() {
        return translate("widgets.defaults.button.name");
    },
    icon: MousePointerClick,

    createDefaultElement: () => {
        // Built once and used for both halves: the appearance model's `default` variant is seeded
        // from these props, so the rows have to be the branded ones or the panel would show the old
        // literals the moment the author opened it.
        const props = {
            ...defaultButtonWidgetProps,
            ...BRANDED_BUTTON_COLORS,
            label: translate("widgets.defaults.button.label"),
        };
        return {
            type: "nl.button",
            name: translate("widgets.defaults.button.name"),
            layout: {
                x: 0,
                y: 0,
                width: 160,
                height: 48,
                opacity: 1,
                visible: true,
            },
            props: {
                ...props,
                appearance: createInitialButtonAppearance(props),
            },
        };
    },

    render: (props: WidgetRendererProps) => <ButtonRenderer {...props} />,

    createInspector: createButtonInspector,

    createDockerBarItems: createButtonDockerBarItems,

    createMultiSelectDockerBarItems: createButtonDockerBarItems,
};
