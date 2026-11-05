import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { extendWidgetModule } from "@/lib/ui-editor/widget-modules/inheritance";
import { ListWidgetModule } from "./list";
import { defineWidgetModule } from "../declaration";
import { NvlListWidgetDeclaration } from "./nvlList.declaration";

export const NvlListWidgetModule: UIWidgetModule = defineWidgetModule(NvlListWidgetDeclaration, extendWidgetModule(ListWidgetModule, {
    type: NvlListWidgetDeclaration.type,
    displayName: () => NvlListWidgetDeclaration.displayName
}));
