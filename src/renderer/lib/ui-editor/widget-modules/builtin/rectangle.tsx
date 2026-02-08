import { Square } from "lucide-react";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { RectangleRenderer } from "./rectangle/renderer";
import { createRectangleInspector } from "./rectangle/inspector";
import { createRectangleDockerBarItems } from "./rectangle/dockerBar";

export const RectangleWidgetModule: UIWidgetModule = {
  type: "nl.rectangle",
  displayName: "Rectangle",
  icon: Square,

  createDefaultElement: () => ({
    type: "nl.rectangle",
    name: "Rectangle",
    layout: {
      x: 0,
      y: 0,
      width: 200,
      height: 150,
      opacity: 1,
      visible: true,
    },
    props: {
      backgroundColor: "#ffffff",
      borderRadius: 0,
      borderRadiusTL: 0,
      borderRadiusTR: 0,
      borderRadiusBL: 0,
      borderRadiusBR: 0,
      borderRadiusLinked: true,
      borderColor: "#000000",
      borderWidth: 1,
      borderStyle: "solid",
      backgroundImage: "",
      backgroundFit: "cover",
      fillType: "color",
      fillVisible: true,
      fillOpacity: 1,
      strokeVisible: true,
      strokeOpacity: 1,
      strokeAlign: "center",
      strokeSide: "all",
      borderJoin: "miter",
      cornerAdvanced: false,
    },
  }),

  render: (props: WidgetRendererProps) => <RectangleRenderer {...props} />,

  createInspector: createRectangleInspector,

  createDockerBarItems: createRectangleDockerBarItems,

  createMultiSelectDockerBarItems: createRectangleDockerBarItems,
};