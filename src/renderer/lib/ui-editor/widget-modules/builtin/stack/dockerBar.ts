import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import { getStackProps } from "./helpers";
import type { StackDirection } from "./types";

export function createStackDockerBarItems(ctx: DockerBarContext): DockerBarItem[] {
  const { element, documentService } = ctx;
  const props = getStackProps(element);

  return [
    {
      kind: "number",
      id: "docker-stack-gap",
      label: "Gap",
      tooltip: "Space between children",
      value: props.gap,
      min: 0,
      max: 256,
      step: 1,
      onChange: (value: number) => {
        documentService.updateElementProps(element.id, {
          ...element.props,
          gap: Math.max(0, value),
        });
      },
    },
    {
      kind: "separator",
      id: "docker-stack-sep",
    },
    {
      kind: "select",
      id: "docker-stack-direction",
      label: "Axis",
      tooltip: "Stack direction",
      value: props.direction,
      options: [
        { value: "vertical", label: "Vertical" },
        { value: "horizontal", label: "Horizontal" },
      ],
      onChange: (value: string | number) => {
        documentService.updateElementProps(element.id, {
          ...element.props,
          direction: String(value) as StackDirection,
        });
      },
    },
  ];
}
