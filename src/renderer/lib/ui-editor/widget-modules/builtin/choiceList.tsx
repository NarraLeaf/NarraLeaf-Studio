import { ListChecks } from "lucide-react";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { extendWidgetModule } from "@/lib/ui-editor/widget-modules/inheritance";
import { patchListWidgetDefaultElement } from "@/lib/ui-editor/widget-modules/shared/list/listWidgetDefaults";
import { ListWidgetModule } from "./list";

const CHOICE_LIST_TYPE = "nl.choice.list";

/**
 * Choice (NarraLeaf menu) slot wrapper. Runtime items ({ text, index, disabled, voiceId }) are
 * injected by the choice slot bridge; hidden choices are filtered before injection. Item clicks feed
 * the `Select Choice` blueprint node through the seeded Choice widget blueprint, and `voiceId` is
 * what `Play Choice Voice` speaks.
 */
export const ChoiceListWidgetModule: UIWidgetModule = extendWidgetModule(ListWidgetModule, {
    type: CHOICE_LIST_TYPE,
    displayName: () => translate("widgets.defaults.choiceList.name"),
    icon: ListChecks,
    defaultElement: inherited =>
        patchListWidgetDefaultElement(inherited, {
            layout: { width: 640, height: 360 },
            props: {
                itemKeyPath: "index",
                itemGap: 16,
                previewItems: [
                    { text: translate("widgets.defaults.choiceList.choiceA"), index: 0, disabled: false, voiceId: "" },
                    { text: translate("widgets.defaults.choiceList.choiceB"), index: 1, disabled: false, voiceId: "" },
                    { text: translate("widgets.defaults.choiceList.choiceC"), index: 2, disabled: true, voiceId: "" },
                ],
                scrollbar: { enabled: false, visibility: "hidden" },
            },
        }),
});
