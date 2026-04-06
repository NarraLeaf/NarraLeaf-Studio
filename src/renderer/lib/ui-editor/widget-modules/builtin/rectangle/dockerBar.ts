import type { UIElement } from "@shared/types/ui-editor/document";
import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import { getProps } from "./helpers";
import type { RectangleProps } from "./types";

export type RectangleDockerBarOptions = {
  resolveProps?: (element: UIElement) => RectangleProps;
};

export function createRectangleDockerBarItems(
  ctx: DockerBarContext,
  options?: RectangleDockerBarOptions,
): DockerBarItem[] {
  const { element, documentService } = ctx;
  const resolve = options?.resolveProps ?? getProps;
  const props = resolve(element);

  return [
    {
      kind: "number",
      id: "docker-border-radius",
      label: "Radius",
      tooltip: "Border radius",
      value: props.borderRadius,
      min: 0,
      step: 1,
      onChange: (value: number) => {
        const patch: Record<string, unknown> = {
          ...element.props,
          borderRadius: value,
        };
        if (props.borderRadiusLinked) {
          patch.borderRadiusTL = value;
          patch.borderRadiusTR = value;
          patch.borderRadiusBL = value;
          patch.borderRadiusBR = value;
        }
        documentService.updateElementProps(element.id, patch);
      },
    },
    {
      kind: "separator",
      id: "docker-sep-1",
    },
    {
      kind: "number",
      id: "docker-border-width",
      label: "Border",
      tooltip: "Border width",
      value: props.borderWidth,
      min: 0,
      step: 1,
      onChange: (value: number) => {
        documentService.updateElementProps(element.id, {
          ...element.props,
          borderWidth: value,
        });
      },
    },
  ];
}
