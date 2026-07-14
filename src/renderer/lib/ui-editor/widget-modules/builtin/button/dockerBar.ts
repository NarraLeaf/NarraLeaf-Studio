import { translate } from "@/lib/i18n";
import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import { getButtonProps } from "./helpers";

export function createButtonDockerBarItems(ctx: DockerBarContext): DockerBarItem[] {
  const { element, documentService } = ctx;
  const props = getButtonProps(element);

  return [
    {
      kind: "number",
      id: "docker-button-pad-x",
      label: translate("widgetChrome.dockerItems.padX"),
      tooltip: translate("widgetChrome.dockerItems.padXHint"),
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
