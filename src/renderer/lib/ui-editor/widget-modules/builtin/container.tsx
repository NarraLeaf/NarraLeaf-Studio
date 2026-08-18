import { Box } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { ContainerRenderer } from "./container/renderer";
import { createContainerInspector } from "./container/inspector";
import { createContainerDockerBarItems } from "./container/dockerBar";
import { defaultContainerWidgetProps } from "@shared/types/ui-editor/container";
import { createInitialContainerAppearance } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { formatBrandLink } from "@shared/brand/brandLink";

/**
 * The colours a *newly created* container starts with - links into the project palette.
 *
 * Not folded into `defaultContainerWidgetProps`: that object answers for containers that never
 * stored a colour, which is every container in every existing project, and a link there would
 * silently restyle work an author already finished. See `button.tsx` for the same reasoning at
 * greater length, including why `container.shadow` is not among these.
 */
const BRANDED_CONTAINER_COLORS = {
  backgroundColor: formatBrandLink("container.background"),
  borderColor: formatBrandLink("container.border")
} as const;

export const ContainerWidgetModule: UIWidgetModule = {
  type: "nl.container",
  logicApi: getWidgetLogicApi("nl.container"),
  get displayName() {
    return translate("widgets.defaults.container.name");
  },
  icon: Box,

  createDefaultElement: () => {
    const props = { ...defaultContainerWidgetProps, ...BRANDED_CONTAINER_COLORS };
    return {
      type: "nl.container",
      name: translate("widgets.defaults.container.name"),
      layout: {
        x: 0,
        y: 0,
        width: 320,
        height: 240,
        opacity: 1,
        visible: true
      },
      props: {
        ...props,
        appearance: createInitialContainerAppearance(props)
      }
    };
  },

  render: (props: WidgetRendererProps) => <ContainerRenderer {...props} />,

  createInspector: createContainerInspector,

  createDockerBarItems: createContainerDockerBarItems,

  createMultiSelectDockerBarItems: createContainerDockerBarItems
};
