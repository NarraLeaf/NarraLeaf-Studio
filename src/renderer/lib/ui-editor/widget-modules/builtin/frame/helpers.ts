import type { UIElement } from "@shared/types/ui-editor/document";
import {
    DEFAULT_UI_FRAME_WIDGET_PROPS,
    getUIFrameWidgetProps,
    type UIFrameWidgetProps,
} from "@shared/types/ui-editor/frame";

export type FrameWidgetProps = UIFrameWidgetProps;

export function getFrameProps(element: Pick<UIElement, "props">): FrameWidgetProps {
    return getUIFrameWidgetProps(element);
}

export function createDefaultFrameProps(): FrameWidgetProps {
    return {
        ...DEFAULT_UI_FRAME_WIDGET_PROPS,
        params: {},
        // Named but unset: a new Page component plays the target Page's own animation. Naming the
        // key is what makes the override a declared prop of this type rather than a stray one.
        animation: undefined,
    };
}
