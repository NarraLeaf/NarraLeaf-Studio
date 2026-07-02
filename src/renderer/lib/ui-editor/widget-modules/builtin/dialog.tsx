import { MessageSquareText } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { createInitialTextAppearance } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { createTextInspector } from "./text/inspector";
import { createTextDockerBarItems } from "./text/dockerBar";
import { defaultTextWidgetProps } from "./text/types";
import { DialogSentenceRenderer } from "./dialog/renderer";

const DIALOG_SENTENCE_TYPE = "nl.dialog.sentence";

function createDialogTextDefault() {
    return {
        type: DIALOG_SENTENCE_TYPE,
        name: "Sentence",
        layout: {
            x: 0,
            y: 0,
            width: 560,
            height: 72,
            opacity: 1,
            visible: true,
        },
        props: {
            ...defaultTextWidgetProps,
            text: "The current line will appear here.",
            fontSize: 24,
            color: "#f8fafc",
            fontWeight: "normal",
            lineHeight: 1.45,
            appearance: createInitialTextAppearance({
                ...defaultTextWidgetProps,
                text: "The current line will appear here.",
                fontSize: 24,
                color: "#f8fafc",
                fontWeight: "normal",
                lineHeight: 1.45,
            }),
        },
    } as const;
}

export const DialogSentenceWidgetModule: UIWidgetModule = {
    type: DIALOG_SENTENCE_TYPE,
    logicApi: getWidgetLogicApi(DIALOG_SENTENCE_TYPE),
    displayName: "Sentence",
    icon: MessageSquareText,
    createDefaultElement: createDialogTextDefault,
    render: DialogSentenceRenderer,
    createInspector: createTextInspector,
    createDockerBarItems: createTextDockerBarItems,
    createMultiSelectDockerBarItems: createTextDockerBarItems,
};
