import { Type } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { TextRenderer } from "./text/renderer";
import { createTextInspector } from "./text/inspector";
import { createTextDockerBarItems } from "./text/dockerBar";
import { defaultTextWidgetProps } from "./text/types";
import { createInitialTextAppearance } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { formatBrandLink } from "@shared/brand/brandLink";

export const TextWidgetModule: UIWidgetModule = {
    type: "nl.text",
    logicApi: getWidgetLogicApi("nl.text"),
    get displayName() {
        return translate("widgets.defaults.text.name");
    },
    icon: Type,

    createDefaultElement: () => {
        // `color` as a link, so a new text node is already the project's ink. Materialised here
        // rather than in `defaultTextWidgetProps`, which is the fallback every *existing* text node
        // reads through and must keep its literal - see `button.tsx` for the full reasoning.
        const props = {
            ...defaultTextWidgetProps,
            color: formatBrandLink("text.primary"),
            text: translate("widgets.defaults.text.text"),
        };
        return {
            type: "nl.text",
            name: translate("widgets.defaults.text.name"),
            layout: {
                x: 0,
                y: 0,
                width: 240,
                height: 48,
                opacity: 1,
                visible: true,
            },
            props: {
                ...props,
                appearance: createInitialTextAppearance(props),
            },
        };
    },

    render: (props: WidgetRendererProps) => <TextRenderer {...props} />,

    createInspector: createTextInspector,

    createDockerBarItems: createTextDockerBarItems,

    createMultiSelectDockerBarItems: createTextDockerBarItems,
};
