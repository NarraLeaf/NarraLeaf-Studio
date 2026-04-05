import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import { getButtonProps } from "./helpers";

export function createButtonDockerBarItems(ctx: DockerBarContext): DockerBarItem[] {
  const { element, documentService } = ctx;
  const props = getButtonProps(element);

  return [
    {
      kind: "number",
      id: "docker-button-radius",
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
      id: "docker-button-sep",
    },
    {
      kind: "number",
      id: "docker-button-pad-x",
      label: "Pad X",
      tooltip: "Horizontal padding",
      value: props.paddingX,
      min: 0,
      max: 128,
      step: 1,
      onChange: (value: number) => {
        documentService.updateElementProps(element.id, {
          ...element.props,
          paddingX: Math.max(0, value),
        });
      },
    },
  ];
}
