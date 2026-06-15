import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import { getTextProps } from "./helpers";
import type { TextAlign } from "./types";

export function createTextDockerBarItems(ctx: DockerBarContext): DockerBarItem[] {
  const { element, documentService } = ctx;
  const props = getTextProps(element);

  return [
    {
      kind: "number",
      id: "docker-text-font-size",
      label: "Size",
      tooltip: "Font size",
      value: props.fontSize,
      min: 8,
      max: 256,
      step: 1,
      onChange: (value: number) => {
        documentService.updateElementProps(element.id, {
          ...element.props,
          fontSize: Math.min(256, Math.max(8, value)),
        });
      },
    },
    {
      kind: "separator",
      id: "docker-text-sep",
    },
    {
      kind: "select",
      id: "docker-text-align",
      label: "Align",
      tooltip: "Text alignment",
      value: props.textAlign,
      options: [
        { value: "left", label: "Left" },
        { value: "center", label: "Center" },
        { value: "right", label: "Right" },
      ],
      onChange: (value: string | number) => {
        documentService.updateElementProps(element.id, {
          ...element.props,
          textAlign: String(value) as TextAlign,
        });
      },
    },
  ];
}
