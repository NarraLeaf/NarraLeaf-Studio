import { MessagesSquare } from "lucide-react";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { extendWidgetModule } from "@/lib/ui-editor/widget-modules/inheritance";
import { patchTextWidgetDefaultElement } from "@/lib/ui-editor/widget-modules/shared/text/textWidgetDefaults";
import { TextWidgetModule } from "./text";
import { NvlTextsRenderer } from "./nvl/renderer";

const NVL_TEXTS_TYPE = "nl.nvl.texts";

/**
 * Engine-coupled NVL text leaf: renders one NVL dialog entry through NarraLeaf React `<Texts>`
 * (type effect included) using the current list item scope to pick its entry. Falls back to a
 * plain text preview outside the live NVL slot runtime.
 */
export const NvlTextsWidgetModule: UIWidgetModule = extendWidgetModule(TextWidgetModule, {
    type: NVL_TEXTS_TYPE,
    displayName: () => translate("widgets.defaults.nvl.name"),
    icon: MessagesSquare,
    defaultElement: inherited =>
        patchTextWidgetDefaultElement(inherited, {
            layout: { width: 760, height: 64 },
            props: {
                text: translate("widgets.defaults.nvl.text"),
                fontSize: 22,
                color: "#f8fafc",
                fontWeight: "normal",
                lineHeight: 1.5,
            },
        }),
    render: NvlTextsRenderer,
    inspector: () => ({
        // Same as the dialog line: the entry the list scope supplies replaces this text at run time.
        remove: ["section.localization"],
        patch: {
            "section.content": { helpText: translate("widgets.text.runtimeTextHelp") },
        },
    }),
});
