import type { UIElement } from "@shared/types/ui-editor/document";
import {
  defaultVideoWidgetProps,
  normalizeVideoProps,
  type UIVideoWidgetProps
} from "@shared/types/ui-editor/video";

export function getVideoProps(element: UIElement): UIVideoWidgetProps {
  return normalizeVideoProps({
    ...defaultVideoWidgetProps,
    ...(element.props ?? {})
  });
}

export function patchVideoProps(
  element: UIElement,
  partial: Partial<UIVideoWidgetProps>
): Record<string, unknown> {
  const current = getVideoProps(element);
  return {
    ...(element.props ?? {}),
    ...current,
    ...partial
  };
}
