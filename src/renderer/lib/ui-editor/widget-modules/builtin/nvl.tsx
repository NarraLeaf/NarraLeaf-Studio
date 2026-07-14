import { MessagesSquare } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { createInitialTextAppearance } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { createTextInspector } from "./text/inspector";
import { createTextDockerBarItems } from "./text/dockerBar";
import { defaultTextWidgetProps } from "./text/types";
import { NvlTextsRenderer } from "./nvl/renderer";

const NVL_TEXTS_TYPE = "nl.nvl.texts";

function createNvlTextsDefault() {
    const textProps = {
        ...defaultTextWidgetProps,
        text: translate("widgets.defaults.nvl.text"),
        fontSize: 22,
        color: "#f8fafc",
        fontWeight: "normal" as const,
        lineHeight: 1.5,
    };
    return {
        type: NVL_TEXTS_TYPE,
        name: translate("widgets.defaults.nvl.name"),
        layout: {
            x: 0,
            y: 0,
            width: 760,
            height: 64,
            opacity: 1,
            visible: true,
        },
        props: {
            ...textProps,
            appearance: createInitialTextAppearance(textProps),
        },
    } as const;
}

/**
 * Engine-coupled NVL text leaf: renders one NVL dialog entry through NarraLeaf React `<Texts>`
 * (type effect included) using the current list item scope to pick its entry. Falls back to a
 * plain text preview outside the live NVL slot runtime.
 */
export const NvlTextsWidgetModule: UIWidgetModule = {
    type: NVL_TEXTS_TYPE,
    logicApi: getWidgetLogicApi(NVL_TEXTS_TYPE),
    get displayName() {
        return translate("widgets.defaults.nvl.name");
    },
    icon: MessagesSquare,
    createDefaultElement: createNvlTextsDefault,
    render: NvlTextsRenderer,
    createInspector: createTextInspector,
    createDockerBarItems: createTextDockerBarItems,
    createMultiSelectDockerBarItems: createTextDockerBarItems,
};
