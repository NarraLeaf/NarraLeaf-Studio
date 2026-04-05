import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import { getContainerProps } from "./helpers";

export function createContainerDockerBarItems(ctx: DockerBarContext): DockerBarItem[] {
  const { element, documentService } = ctx;
  const props = getContainerProps(element);

  return [
    {
      kind: "number",
      id: "docker-container-radius",
      label: "Radius",
      tooltip: "Corner radius",
      value: props.borderRadius,
      min: 0,
      max: 999,
      step: 1,
      onChange: (value: number) => {
        documentService.updateElementProps(element.id, {
          ...element.props,
          borderRadius: Math.max(0, value),
        });
      },
    },
    {
      kind: "separator",
      id: "docker-container-sep",
    },
    {
      kind: "number",
      id: "docker-container-border",
      label: "Border",
      tooltip: "Border width",
      value: props.borderWidth,
      min: 0,
      max: 64,
      step: 1,
      onChange: (value: number) => {
        documentService.updateElementProps(element.id, {
          ...element.props,
          borderWidth: Math.max(0, value),
        });
      },
    },
  ];
}
