import type { UIElement } from "@shared/types/ui-editor/document";
import {
    clampContainerStackSpacingPx,
    containerLayoutUsesScrollViewport,
    defaultContainerWidgetProps,
    getContainerChildLayoutParticipation,
    normalizeContainerClipContent,
    type ContainerChildLayoutParticipation,
    type ContainerLayoutKind,
    type ContainerWidgetProps,
} from "@shared/types/ui-editor/container";

function finiteOr(fallback: number, value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function getContainerProps(element: UIElement): ContainerWidgetProps {
    const p = element.props as Partial<ContainerWidgetProps> | undefined;
    const base = defaultContainerWidgetProps;
    const merged: ContainerWidgetProps = {
        ...base,
        ...p,
        clipContent: normalizeContainerClipContent(p?.clipContent),
    };
    return {
        ...merged,
        stackGap: clampContainerStackSpacingPx(finiteOr(base.stackGap, merged.stackGap)),
        stackPaddingTop: clampContainerStackSpacingPx(finiteOr(base.stackPaddingTop, merged.stackPaddingTop)),
        stackPaddingRight: clampContainerStackSpacingPx(finiteOr(base.stackPaddingRight, merged.stackPaddingRight)),
        stackPaddingBottom: clampContainerStackSpacingPx(finiteOr(base.stackPaddingBottom, merged.stackPaddingBottom)),
        stackPaddingLeft: clampContainerStackSpacingPx(finiteOr(base.stackPaddingLeft, merged.stackPaddingLeft)),
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
