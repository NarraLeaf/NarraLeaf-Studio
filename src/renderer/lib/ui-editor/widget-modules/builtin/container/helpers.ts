import type { UIElement } from "@shared/types/ui-editor/document";
import { defaultContainerWidgetProps, type ContainerWidgetProps } from "@shared/types/ui-editor/container";

export function getContainerProps(element: UIElement): ContainerWidgetProps {
    const p = element.props as Partial<ContainerWidgetProps> | undefined;
    return {
        ...defaultContainerWidgetProps,
        ...p,
    };
}
