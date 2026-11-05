import { ScrollText } from "lucide-react";
import { translate } from "@/lib/i18n";
import { UI_STRUCT_ID_NVL_ITEM } from "@shared/types/ui-editor/builtinStructs";
import { patchListWidgetDefaultElement } from "@/lib/ui-editor/widget-modules/shared/list/listWidgetDefaults";
import type { UIWidgetDeclaration } from "../types";
import { extendWidgetDeclaration } from "../declaration";
import { ListWidgetDeclaration } from "./list.declaration";

const NVL_LIST_TYPE = "nl.nvl.list";
export const NvlListWidgetDeclaration: UIWidgetDeclaration = extendWidgetDeclaration(ListWidgetDeclaration, {
    type: NVL_LIST_TYPE,
    displayName: () => translate("widgets.defaults.nvlList.name"),
    icon: ScrollText,
    defaultElement: (inherited, words) => patchListWidgetDefaultElement(inherited, {
        layout: { width: 960, height: 620 },
        props: {
            itemStructId: UI_STRUCT_ID_NVL_ITEM,
            itemKeyFieldId: "index",
            itemGap: 18,
            items: [
                { nametag: words.t("widgets.defaults.nvlList.speaker"), index: 0, isActive: false },
                { nametag: "", index: 1, isActive: true },
            ],
        },
    })
});
