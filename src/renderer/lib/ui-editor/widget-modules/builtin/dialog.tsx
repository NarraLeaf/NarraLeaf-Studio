import { MessageSquareText } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { createInitialTextAppearance } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { createTextInspector } from "./text/inspector";
import { createTextDockerBarItems } from "./text/dockerBar";
import { defaultTextWidgetProps } from "./text/types";
import { DialogSentenceRenderer } from "./dialog/renderer";

const DIALOG_SENTENCE_TYPE = "nl.dialog.sentence";

function createDialogTextDefault() {
    const textProps = {
        ...defaultTextWidgetProps,
        text: translate("widgets.defaults.dialog.text"),
        fontSize: 24,
        color: "#f8fafc",
        fontWeight: "normal" as const,
        lineHeight: 1.45,
    };
    return {
        type: DIALOG_SENTENCE_TYPE,
        name: translate("widgets.defaults.dialog.name"),
        layout: {
            x: 0,
            y: 0,
            width: 560,
            height: 72,
            opacity: 1,
            visible: true,
        },
        props: {
            ...textProps,
            appearance: createInitialTextAppearance(textProps),
        },
    } as const;
}

export const DialogSentenceWidgetModule: UIWidgetModule = {
    type: DIALOG_SENTENCE_TYPE,
    logicApi: getWidgetLogicApi(DIALOG_SENTENCE_TYPE),
    get displayName() {
        return translate("widgets.defaults.dialog.name");
    },
    icon: MessageSquareText,
    createDefaultElement: createDialogTextDefault,
    render: DialogSentenceRenderer,
    createInspector: createTextInspector,
    createDockerBarItems: createTextDockerBarItems,
    createMultiSelectDockerBarItems: createTextDockerBarItems,
};
