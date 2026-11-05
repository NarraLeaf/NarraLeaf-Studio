import { MessagesSquare } from "lucide-react";
import { translate } from "@/lib/i18n";
import { patchTextWidgetDefaultElement } from "@/lib/ui-editor/widget-modules/shared/text/textWidgetDefaults";
import type { UIWidgetDeclaration } from "../types";
import { extendWidgetDeclaration } from "../declaration";
import { TextWidgetDeclaration } from "./text.declaration";

const NVL_TEXTS_TYPE = "nl.nvl.texts";
export const NvlTextsWidgetDeclaration: UIWidgetDeclaration = extendWidgetDeclaration(TextWidgetDeclaration, {
    type: NVL_TEXTS_TYPE,
    displayName: () => translate("widgets.defaults.nvl.name"),
    icon: MessagesSquare,
    defaultElement: (inherited, words) => patchTextWidgetDefaultElement(inherited, {
        layout: { width: 760, height: 64 },
        props: {
            text: words.t("widgets.defaults.nvl.text"),
            fontSize: 22,
            color: "#f8fafc",
            fontWeight: "normal",
            lineHeight: 1.5,
        },
    })
});
