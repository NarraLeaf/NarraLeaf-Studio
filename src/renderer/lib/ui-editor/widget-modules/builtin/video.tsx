import { Film } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { UI_VIDEO_ELEMENT_TYPE, defaultVideoWidgetProps } from "@shared/types/ui-editor/video";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { VideoRenderer } from "./video/renderer";
import { createVideoInspector } from "./video/inspector";
import { createVideoDockerBarItems, createVideoMultiSelectDockerBarItems } from "./video/dockerBar";

export const VideoWidgetModule: UIWidgetModule = {
  type: UI_VIDEO_ELEMENT_TYPE,
  logicApi: getWidgetLogicApi(UI_VIDEO_ELEMENT_TYPE),
  get displayName() {
    return translate("widgets.defaults.video.name");
  },
  icon: Film,

  createDefaultElement: () => ({
    type: UI_VIDEO_ELEMENT_TYPE,
    name: translate("widgets.defaults.video.name"),
    layout: {
      x: 0,
      y: 0,
      // 16:9, the aspect nearly every source clip already is - so `contain` letterboxes
      // nothing on insert and the author sees the frame, not two black bars.
      width: 480,
      height: 270,
      opacity: 1,
      visible: true
    },
    props: {
      ...defaultVideoWidgetProps,
      // Chrome defaults: black behind the picture, because `objectFit: "contain"` shows the box
      // wherever the clip's aspect does not match and white bars read as a rendering fault.
      backgroundColor: "#000000",
      fillType: "color",
      fillVisible: true,
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
      transformOpacity: 1
    }
  }),

  render: (props: WidgetRendererProps) => <VideoRenderer {...props} />,

  createInspector: createVideoInspector,

  createDockerBarItems: createVideoDockerBarItems,

  createMultiSelectDockerBarItems: createVideoMultiSelectDockerBarItems
};
