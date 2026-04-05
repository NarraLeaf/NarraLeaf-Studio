import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import { getListRepeaterProps } from "./helpers";

export function createListRepeaterDockerBarItems(ctx: DockerBarContext): DockerBarItem[] {
  const { element, documentService } = ctx;
  const props = getListRepeaterProps(element);

  return [
    {
      kind: "number",
      id: "docker-list-item-gap",
      label: "Gap",
      tooltip: "Space between list items",
      value: props.itemGap,
      min: 0,
      max: 128,
      step: 1,
      onChange: (value: number) => {
        documentService.updateElementProps(element.id, {
          ...element.props,
          itemGap: Math.max(0, value),
        });
      },
    },
    {
      kind: "separator",
      id: "docker-list-sep",
    },
    {
      kind: "number",
      id: "docker-list-preview",
      label: "Preview",
      tooltip: "Preview item count in editor",
      value: props.previewCount,
      min: 1,
      max: 32,
      step: 1,
      onChange: (value: number) => {
        const clamped = Math.min(32, Math.max(1, Math.round(value)));
        documentService.updateElementProps(element.id, {
          ...element.props,
          previewCount: clamped,
        });
      },
    },
  ];
}
