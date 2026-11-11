import { ListChecks } from "lucide-react";
import { translate } from "@/lib/i18n";
import { UI_STRUCT_ID_CHOICE_ITEM } from "@shared/types/ui-editor/builtinStructs";
import { patchListWidgetDefaultElement } from "@/lib/ui-editor/widget-modules/shared/list/listWidgetDefaults";
import type { UIWidgetDeclaration } from "../types";
import { extendWidgetDeclaration } from "../declaration";
import { ListWidgetDeclaration } from "./list.declaration";

const CHOICE_LIST_TYPE = "nl.choice.list";
export const ChoiceListWidgetDeclaration: UIWidgetDeclaration = extendWidgetDeclaration(ListWidgetDeclaration, {
    type: CHOICE_LIST_TYPE,
    displayName: () => translate("widgets.defaults.choiceList.name"),
    icon: ListChecks,
    defaultElement: (inherited, words) => patchListWidgetDefaultElement(inherited, {
        layout: { width: 640, height: 360 },
        props: {
            itemStructId: UI_STRUCT_ID_CHOICE_ITEM,
            itemKeyFieldId: "index",
            itemGap: 16,
            items: [
                { text: words.t("widgets.defaults.choiceList.choiceA"), index: 0, disabled: false, voiceId: "" },
                { text: words.t("widgets.defaults.choiceList.choiceB"), index: 1, disabled: false, voiceId: "" },
                { text: words.t("widgets.defaults.choiceList.choiceC"), index: 2, disabled: true, voiceId: "" },
            ],
            scrollbar: { enabled: false, visibility: "hidden" },
        },
    })
});
