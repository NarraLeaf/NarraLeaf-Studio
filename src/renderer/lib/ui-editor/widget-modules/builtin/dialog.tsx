import { MessageSquareText } from "lucide-react";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { extendWidgetModule } from "@/lib/ui-editor/widget-modules/inheritance";
import { patchTextWidgetDefaultElement } from "@/lib/ui-editor/widget-modules/shared/text/textWidgetDefaults";
import { TextWidgetModule } from "./text";
import { DialogSentenceRenderer } from "./dialog/renderer";

const DIALOG_SENTENCE_TYPE = "nl.dialog.sentence";

/**
 * The dialog slot's line: a Text whose live renderer hands the sentence to the engine's typewriter.
 *
 * Everything an author sets on a Text - typography, vertical writing, appearance variants, effects -
 * is inherited, so a text feature reaches the dialog line without being wired a second time.
 */
export const DialogSentenceWidgetModule: UIWidgetModule = extendWidgetModule(TextWidgetModule, {
    type: DIALOG_SENTENCE_TYPE,
    displayName: () => translate("widgets.defaults.dialog.name"),
    icon: MessageSquareText,
    defaultElement: inherited =>
        patchTextWidgetDefaultElement(inherited, {
            layout: { width: 560, height: 72 },
            props: {
                text: translate("widgets.defaults.dialog.text"),
                fontSize: 24,
                color: "#f8fafc",
                fontWeight: "normal",
                lineHeight: 1.45,
            },
        }),
    render: DialogSentenceRenderer,
    inspector: () => ({
        // The authored text is a design-time stand-in: at run time the story's sentence replaces it,
        // which is also why the localization pipeline never collected it. The inherited section
        // offered an opt-in that nothing downstream reads.
        remove: ["section.localization"],
    }),
});
