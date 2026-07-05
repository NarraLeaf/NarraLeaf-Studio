import { MessagesSquare } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { createInitialTextAppearance } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { createTextInspector } from "./text/inspector";
import { createTextDockerBarItems } from "./text/dockerBar";
import { defaultTextWidgetProps } from "./text/types";
import { NvlTextsRenderer } from "./nvl/renderer";

const NVL_TEXTS_TYPE = "nl.nvl.texts";

function createNvlTextsDefault() {
    return {
        type: NVL_TEXTS_TYPE,
        name: "NVL Texts",
        layout: {
            x: 0,
            y: 0,
            width: 760,
            height: 64,
            opacity: 1,
            visible: true,
        },
        props: {
            ...defaultTextWidgetProps,
            text: "The dialog entry text will appear here.",
            fontSize: 22,
            color: "#f8fafc",
            fontWeight: "normal",
            lineHeight: 1.5,
            appearance: createInitialTextAppearance({
                ...defaultTextWidgetProps,
                text: "The dialog entry text will appear here.",
                fontSize: 22,
                color: "#f8fafc",
                fontWeight: "normal",
                lineHeight: 1.5,
            }),
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
    displayName: "NVL Texts",
    icon: MessagesSquare,
    createDefaultElement: createNvlTextsDefault,
    render: NvlTextsRenderer,
    createInspector: createTextInspector,
    createDockerBarItems: createTextDockerBarItems,
    createMultiSelectDockerBarItems: createTextDockerBarItems,
};
