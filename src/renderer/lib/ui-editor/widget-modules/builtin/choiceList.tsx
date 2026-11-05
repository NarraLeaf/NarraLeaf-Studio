import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { extendWidgetModule } from "@/lib/ui-editor/widget-modules/inheritance";
import { ListWidgetModule } from "./list";
import { defineWidgetModule } from "../declaration";
import { ChoiceListWidgetDeclaration } from "./choiceList.declaration";

export const ChoiceListWidgetModule: UIWidgetModule = defineWidgetModule(ChoiceListWidgetDeclaration, extendWidgetModule(ListWidgetModule, {
    type: ChoiceListWidgetDeclaration.type,
    displayName: () => ChoiceListWidgetDeclaration.displayName
}));
