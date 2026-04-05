import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import { getImageProps } from "./helpers";
import type { ImageObjectFit } from "./types";

export function createImageDockerBarItems(ctx: DockerBarContext): DockerBarItem[] {
  const { element, documentService } = ctx;
  const props = getImageProps(element);
  const opacityPercent = Math.round(props.imageOpacity * 100);

  return [
    {
      kind: "select",
      id: "docker-image-fit",
      label: "Fit",
      tooltip: "Object fit",
      value: props.objectFit,
      options: [
        { value: "cover", label: "Cover" },
        { value: "contain", label: "Contain" },
        { value: "fill", label: "Fill" },
      ],
      onChange: (value: string | number) => {
        documentService.updateElementProps(element.id, {
          ...element.props,
          objectFit: String(value) as ImageObjectFit,
        });
      },
    },
    {
      kind: "separator",
      id: "docker-image-sep-1",
    },
    {
      kind: "number",
      id: "docker-image-radius",
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
      id: "docker-image-sep-2",
    },
    {
      kind: "number",
      id: "docker-image-opacity",
      label: "Opacity",
      tooltip: "Image opacity (%)",
      value: opacityPercent,
      min: 0,
      max: 100,
      step: 1,
      onChange: (value: number) => {
        const clamped = Math.min(100, Math.max(0, value));
        documentService.updateElementProps(element.id, {
          ...element.props,
          imageOpacity: clamped / 100,
        });
      },
    },
  ];
}
