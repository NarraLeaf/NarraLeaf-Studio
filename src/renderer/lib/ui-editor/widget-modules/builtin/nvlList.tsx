import { ScrollText } from "lucide-react";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { UI_STRUCT_ID_NVL_ITEM } from "@shared/types/ui-editor/builtinStructs";
import { extendWidgetModule } from "@/lib/ui-editor/widget-modules/inheritance";
import { patchListWidgetDefaultElement } from "@/lib/ui-editor/widget-modules/shared/list/listWidgetDefaults";
import { ListWidgetModule } from "./list";

const NVL_LIST_TYPE = "nl.nvl.list";

/**
 * NVL slot wrapper. Runtime items are injected by the NVL slot bridge; the raw NvlDialogProxy
 * entries flow through `NvlSlotItemsContext` so the private `nl.nvl.texts` leaf can render the
 * engine-coupled type effect. The row shape is the engine's - see the built-in struct it names.
 */
export const NvlListWidgetModule: UIWidgetModule = extendWidgetModule(ListWidgetModule, {
    type: NVL_LIST_TYPE,
    displayName: () => translate("widgets.defaults.nvlList.name"),
    icon: ScrollText,
    defaultElement: inherited =>
        patchListWidgetDefaultElement(inherited, {
            layout: { width: 960, height: 620 },
            props: {
                itemStructId: UI_STRUCT_ID_NVL_ITEM,
                itemKeyFieldId: "index",
                itemGap: 18,
                items: [
                    { nametag: translate("widgets.defaults.nvlList.speaker"), index: 0, isActive: false },
                    { nametag: "", index: 1, isActive: true },
                ],
            },
        }),
});
