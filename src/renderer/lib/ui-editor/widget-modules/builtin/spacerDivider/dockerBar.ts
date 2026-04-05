import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import { getSpacerDividerProps } from "./helpers";
import type { SpacerDividerMode } from "./types";

export function createSpacerDividerDockerBarItems(ctx: DockerBarContext): DockerBarItem[] {
  const { element, documentService } = ctx;
  const props = getSpacerDividerProps(element);

  return [
    {
      kind: "number",
      id: "docker-spacer-thickness",
      label: "Size",
      tooltip: "Thickness (divider) or spacer size",
      value: props.thickness,
      min: 1,
      max: 64,
      step: 1,
      onChange: (value: number) => {
        documentService.updateElementProps(element.id, {
          ...element.props,
          thickness: Math.min(64, Math.max(1, value)),
        });
      },
    },
    {
      kind: "separator",
      id: "docker-spacer-sep",
    },
    {
      kind: "select",
      id: "docker-spacer-mode",
      label: "Mode",
      tooltip: "Spacer or divider",
      value: props.mode,
      options: [
        { value: "spacer", label: "Spacer" },
        { value: "divider", label: "Divider" },
      ],
      onChange: (value: string | number) => {
        documentService.updateElementProps(element.id, {
          ...element.props,
          mode: String(value) as SpacerDividerMode,
        });
      },
    },
  ];
}
