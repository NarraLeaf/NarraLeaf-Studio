import { MessageSquareText } from "lucide-react";
import { translate } from "@/lib/i18n";
import { patchTextWidgetDefaultElement } from "@/lib/ui-editor/widget-modules/shared/text/textWidgetDefaults";
import type { UIWidgetDeclaration } from "../types";
import { extendWidgetDeclaration } from "../declaration";
import { TextWidgetDeclaration } from "./text.declaration";

const DIALOG_SENTENCE_TYPE = "nl.dialog.sentence";
export const DialogSentenceWidgetDeclaration: UIWidgetDeclaration = extendWidgetDeclaration(TextWidgetDeclaration, {
    type: DIALOG_SENTENCE_TYPE,
    displayName: () => translate("widgets.defaults.dialog.name"),
    icon: MessageSquareText,
    defaultElement: (inherited, words) => patchTextWidgetDefaultElement(inherited, {
        layout: { width: 560, height: 72 },
        props: {
            text: words.t("widgets.defaults.dialog.text"),
            fontSize: 24,
            color: "#f8fafc",
            fontWeight: "normal",
            lineHeight: 1.45,
            // A dialogue line is written once and read in every language the game ships in, so
            // it fits itself to its box unless the author turns that off.
            textAutoFit: true,
        },
    })
});
