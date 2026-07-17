import { TextCursorInput } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { createInitialButtonAppearance } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { TextInputRenderer } from "./textInput/renderer";
import { createTextInputInspector } from "./textInput/inspector";
import { defaultTextInputElementProps, textInputButtonBaselineProps } from "./textInput/helpers";

export const TextInputWidgetModule: UIWidgetModule = {
    type: "nl.textInput",
    logicApi: getWidgetLogicApi("nl.textInput"),
    get displayName() {
        return translate("widgets.defaults.textInput.name");
    },
    icon: TextCursorInput,

    createDefaultElement: () => ({
        type: "nl.textInput",
        name: translate("widgets.defaults.textInput.name"),
        layout: {
            x: 0,
            y: 0,
            width: 220,
            height: 40,
            opacity: 1,
            visible: true,
        },
        // No baked placeholder: it is player-facing text, so it stays empty until the author writes
        // one (and, if the game ships localized, attaches a localization key to it).
        props: {
            ...defaultTextInputElementProps,
            appearance: createInitialButtonAppearance(textInputButtonBaselineProps(defaultTextInputElementProps)),
        },
    }),

    render: (props: WidgetRendererProps) => <TextInputRenderer {...props} />,

    createInspector: createTextInputInspector,
};
