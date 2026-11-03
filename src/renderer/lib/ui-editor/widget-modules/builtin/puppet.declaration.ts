import { PersonStanding } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { UI_PUPPET_ELEMENT_TYPE, defaultPuppetWidgetProps } from "@shared/types/ui-editor/puppet";
import { translate } from "@/lib/i18n";
import type { UIWidgetDeclaration } from "../types";

export const PuppetWidgetDeclaration: UIWidgetDeclaration = {
    type: UI_PUPPET_ELEMENT_TYPE,
    logicApi: getWidgetLogicApi(UI_PUPPET_ELEMENT_TYPE),
    /** The palette names supported formats; the stored type stays stable as formats are added. */
    get displayName() {
        return translate("widgets.defaults.puppet.name");
    },
    icon: PersonStanding,
    createDefaultElement: () => ({
        type: UI_PUPPET_ELEMENT_TYPE,
        /**
         * The short name here, not the palette's.
         * "Spine / Live2D Model" is what an author has to *find*, so the palette says it; it is not
         * what four of them should be called in the outline, where every other widget is one word.
         */
        name: translate("widgets.puppet.title"),
        layout: {
            x: 0,
            y: 0,
            // Portrait, because a 2D character model is: a landscape default would open every model
            // letterboxed into the middle third of its own box.
            width: 360,
            height: 540,
            opacity: 1,
            visible: true,
        },
        props: {
            ...defaultPuppetWidgetProps,
            // No fill by default. A model is drawn over whatever the Surface put behind it, and an
            // opaque default would hide that until the author found the Box section and turned it off.
            backgroundColor: "#000000",
            fillType: "color",
            fillVisible: false,
            fillOpacity: 1,
            borderRadius: 0,
            borderRadiusTL: 0,
            borderRadiusTR: 0,
            borderRadiusBL: 0,
            borderRadiusBR: 0,
            borderRadiusLinked: true,
            borderColor: "#000000",
            borderWidth: 0,
            borderStyle: "solid",
            strokeVisible: false,
            strokeOpacity: 1,
            strokeAlign: "inside",
            strokeSide: "all",
            borderJoin: "miter",
            cornerAdvanced: false,
            transformOffsetX: 0,
            transformOffsetY: 0,
            transformScale: 1,
            transformRotation: 0,
            transformOpacity: 1,
        },
    })
};
