import { translate } from "@/lib/i18n";
import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import { isAppearanceModel } from "@shared/types/ui-editor/appearance";
import {
  createInitialTextAppearance,
  ensureTextAppearanceHasAllKeys,
  isUsableAppearanceModel,
  patchTextAppearanceDefaultRows,
} from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { getTextProps } from "./helpers";
import type { TextAlign } from "./types";
import type { TextWidgetProps } from "./types";

function patchTextDockerProps(ctx: DockerBarContext, patch: Partial<TextWidgetProps>) {
  const { element, documentService } = ctx;
  const live = documentService.getDocument().elements[element.id] ?? element;
  const flat = getTextProps(live);
  const nextFlat: TextWidgetProps = {
    ...flat,
    ...patch,
    effects: patch.effects ?? flat.effects,
  };
  const rawAppearance = (live.props as { appearance?: unknown } | undefined)?.appearance;
  const baseAppearance: AppearanceModel | null = isAppearanceModel(rawAppearance) ? rawAppearance : null;
  let nextAppearance = baseAppearance;
  if ("fontSize" in patch) {
    const ensured = isUsableAppearanceModel(baseAppearance)
      ? ensureTextAppearanceHasAllKeys(baseAppearance, nextFlat)
      : createInitialTextAppearance(nextFlat);
    nextAppearance = patchTextAppearanceDefaultRows(ensured, {
      fontSize: nextFlat.fontSize,
    });
  }
  documentService.updateElementProps(element.id, {
    ...live.props,
    ...patch,
    ...(nextAppearance ? { appearance: nextAppearance } : {}),
  });
}

export function createTextDockerBarItems(ctx: DockerBarContext): DockerBarItem[] {
  const { element } = ctx;
  const props = getTextProps(element);

  return [
    {
      kind: "number",
      id: "docker-text-font-size",
      label: translate("widgetChrome.dockerItems.size"),
      tooltip: translate("widgetChrome.dockerItems.fontSize"),
      value: props.fontSize,
      min: 8,
      max: 256,
      step: 1,
      onChange: (value: number) => {
        patchTextDockerProps(ctx, {
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
      label: translate("widgetChrome.dockerItems.align"),
      tooltip: translate("widgetChrome.dockerItems.textAlign"),
      value: props.textAlign,
      options: [
        { value: "left", label: translate("widgetChrome.dockerItems.left") },
        { value: "center", label: translate("widgetChrome.dockerItems.center") },
        { value: "right", label: translate("widgetChrome.dockerItems.right") },
      ],
      onChange: (value: string | number) => {
        patchTextDockerProps(ctx, {
          textAlign: String(value) as TextAlign,
        });
      },
    },
  ];
}
