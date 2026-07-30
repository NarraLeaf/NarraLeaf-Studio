import { PersonStanding } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { UI_PUPPET_ELEMENT_TYPE, defaultPuppetWidgetProps } from "@shared/types/ui-editor/puppet";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { PuppetRenderer } from "./puppet/renderer";
import { createPuppetInspector } from "./puppet/inspector";
import { createPuppetDockerBarItems } from "./puppet/dockerBar";

export const PuppetWidgetModule: UIWidgetModule = {
    type: UI_PUPPET_ELEMENT_TYPE,
    logicApi: getWidgetLogicApi(UI_PUPPET_ELEMENT_TYPE),
    /**
     * The stored type is renderer-agnostic; the name an author reads is not. "Puppet" tells nobody
     * what the widget is for, so the palette says "Spine2D / Live2D Model" while the schema stays
     * `nl.puppet` - user ruling 2026-07-29. Adding another format later is a folder in the author's
     * project, not a document migration.
     */
    get displayName() {
        return translate("widgets.defaults.puppet.name");
    },
    icon: PersonStanding,

    createDefaultElement: () => ({
        type: UI_PUPPET_ELEMENT_TYPE,
        name: translate("widgets.defaults.puppet.name"),
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
    }),

    render: (props: WidgetRendererProps) => <PuppetRenderer {...props} />,

    createInspector: createPuppetInspector,

    createDockerBarItems: createPuppetDockerBarItems,

    createMultiSelectDockerBarItems: createPuppetDockerBarItems,
};
