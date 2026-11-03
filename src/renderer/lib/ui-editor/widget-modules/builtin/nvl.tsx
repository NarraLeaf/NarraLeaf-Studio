import { translate } from "@/lib/i18n";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { extendWidgetModule } from "@/lib/ui-editor/widget-modules/inheritance";
import { TextWidgetModule } from "./text";
import { NvlTextsSampleTextField } from "./text/TextSourceField";
import { NvlTextsRenderer } from "./nvl/renderer";
import { defineWidgetModule } from "../declaration";
import { NvlTextsWidgetDeclaration } from "./nvl.declaration";

export const NvlTextsWidgetModule: UIWidgetModule = defineWidgetModule(NvlTextsWidgetDeclaration, extendWidgetModule(TextWidgetModule, {
    type: NvlTextsWidgetDeclaration.type,
    displayName: () => NvlTextsWidgetDeclaration.displayName,
    render: NvlTextsRenderer,
    inspector: () => ({
        // Same as the dialog line: the entry the list scope supplies replaces this text at run time,
        // so the field holds sample words and nothing else.
        patch: {
            "text.content": {
                component: NvlTextsSampleTextField,
                label: translate("widgets.sampleText.label"),
            },
        },
    })
}));
