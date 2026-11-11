import { Gamepad2 } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { DEFAULT_UI_INPUT_HINTS_PROPS, UI_INPUT_HINTS_ELEMENT_TYPE } from "@shared/types/ui-editor/inputHints";
import { translate } from "@/lib/i18n";
import type { UIWidgetDeclaration } from "../types";

export const InputHintsWidgetDeclaration: UIWidgetDeclaration = {
    type: UI_INPUT_HINTS_ELEMENT_TYPE,
    logicApi: getWidgetLogicApi(UI_INPUT_HINTS_ELEMENT_TYPE),
    get displayName() {
        return translate("widgets.defaults.inputHints.name");
    },
    icon: Gamepad2,
    createDefaultElement: () => ({
        type: UI_INPUT_HINTS_ELEMENT_TYPE,
        name: translate("widgets.defaults.inputHints.name"),
        // A strip along the bottom of a 1920-wide screen, where every console menu keeps it.
        layout: {
            x: 0,
            y: 0,
            width: 900,
            height: 48,
            opacity: 1,
            visible: true,
        },
        props: { ...DEFAULT_UI_INPUT_HINTS_PROPS },
    })
};
