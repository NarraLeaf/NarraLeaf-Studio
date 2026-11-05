import { translate } from "@/lib/i18n";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { extendWidgetModule } from "@/lib/ui-editor/widget-modules/inheritance";
import { TextWidgetModule } from "./text";
import { DialogSentenceSampleTextField } from "./text/TextSourceField";
import { DialogSentenceRenderer } from "./dialog/renderer";
import { defineWidgetModule } from "../declaration";
import { DialogSentenceWidgetDeclaration } from "./dialog.declaration";

export const DialogSentenceWidgetModule: UIWidgetModule = defineWidgetModule(DialogSentenceWidgetDeclaration, extendWidgetModule(TextWidgetModule, {
    type: DialogSentenceWidgetDeclaration.type,
    displayName: () => DialogSentenceWidgetDeclaration.displayName,
    render: DialogSentenceRenderer,
    inspector: () => ({
        // The authored text is a design-time stand-in: at run time the story's sentence replaces it,
        // which is also why the localization pipeline never collected it. A translation key, the
        // "Localize text" switch or a Blueprint Value would all change words no player sees, so the
        // field holds sample words and nothing else.
        patch: {
            "text.content": {
                component: DialogSentenceSampleTextField,
                label: translate("widgets.sampleText.label"),
            },
        },
    })
}));
