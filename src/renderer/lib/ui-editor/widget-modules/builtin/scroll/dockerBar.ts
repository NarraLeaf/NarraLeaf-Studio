import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import { getScrollProps } from "./helpers";
import type { ScrollAxis } from "./types";

export function createScrollDockerBarItems(ctx: DockerBarContext): DockerBarItem[] {
  const { element, documentService } = ctx;
  const props = getScrollProps(element);

  return [
    {
      kind: "select",
      id: "docker-scroll-axis",
      label: "Axis",
      tooltip: "Scroll axis",
      value: props.axis,
      options: [
        { value: "y", label: "Vertical" },
        { value: "x", label: "Horizontal" },
      ],
      onChange: (value: string | number) => {
        documentService.updateElementProps(element.id, {
          ...element.props,
          axis: String(value) as ScrollAxis,
        });
      },
    },
  ];
}
