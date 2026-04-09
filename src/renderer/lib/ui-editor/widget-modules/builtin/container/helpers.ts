import type { UIElement } from "@shared/types/ui-editor/document";
import {
    containerLayoutUsesScrollViewport,
    defaultContainerWidgetProps,
    getContainerChildLayoutParticipation,
    normalizeContainerClipContent,
    type ContainerChildLayoutParticipation,
    type ContainerLayoutKind,
    type ContainerWidgetProps,
} from "@shared/types/ui-editor/container";

export function getContainerProps(element: UIElement): ContainerWidgetProps {
    const p = element.props as Partial<ContainerWidgetProps> | undefined;
    return {
        ...defaultContainerWidgetProps,
        ...p,
        clipContent: normalizeContainerClipContent(p?.clipContent),
    };
}

/** Resolved authoring axes: child layout participation vs box clipping (orthogonal to `layoutKind` scroll viewport). */
export type ResolvedContainerSemantics = {
    layoutKind: ContainerLayoutKind;
    childLayoutParticipation: ContainerChildLayoutParticipation;
    clipContent: boolean;
    hasScrollViewport: boolean;
};

export function getResolvedContainerSemantics(element: UIElement): ResolvedContainerSemantics {
    const props = getContainerProps(element);
    return {
        layoutKind: props.layoutKind,
        childLayoutParticipation: getContainerChildLayoutParticipation(props.layoutKind),
        clipContent: props.clipContent,
        hasScrollViewport: containerLayoutUsesScrollViewport(props.layoutKind),
    };
}
