import { PanelTop } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { FrameRenderer } from "./frame/renderer";
import { createFrameInspector } from "./frame/inspector";
import { createDefaultFrameProps } from "./frame/helpers";
import { createFrameFloatingToolbarItems } from "./frame/floatingToolbar";
import { createFrameLayoutSizeField } from "./frame/layoutInspector";

export const FrameWidgetModule: UIWidgetModule = {
    type: UI_FRAME_ELEMENT_TYPE,
    logicApi: getWidgetLogicApi(UI_FRAME_ELEMENT_TYPE),
    get displayName() {
        return translate("widgets.defaults.frame.name");
    },
    icon: PanelTop,

    createDefaultElement: () => ({
        type: UI_FRAME_ELEMENT_TYPE,
        name: translate("widgets.defaults.frame.name"),
        layout: {
            x: 0,
            y: 0,
            width: 320,
            height: 180,
            opacity: 1,
            visible: true,
            lockAspectRatio: true,
        },
        props: createDefaultFrameProps(),
    }),

    render: (props: WidgetRendererProps) => <FrameRenderer {...props} />,

    createInspector: createFrameInspector,

    createFloatingToolbarItems: createFrameFloatingToolbarItems,

    createLayoutSizeField: createFrameLayoutSizeField,
};
