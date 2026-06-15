import type { UILayout } from "@shared/types/ui-editor/document";
import type { ContainerLayoutKind, ContainerStackDirection } from "@shared/types/ui-editor/container";

/** Divider-style strip: thin free-layout bar; user can stretch width on canvas. */
export function buildDividerPreset(): { layout: Partial<UILayout>; props: Record<string, unknown> } {
    return {
        layout: { height: 4 },
        props: {
            layoutKind: "free" as ContainerLayoutKind,
            fillType: "color",
            fillVisible: true,
            backgroundColor: "#ffffff2a",
            borderWidth: 0,
            borderRadius: 0,
            strokeVisible: false,
            clipContent: false,
        },
    };
}

/** One-click vertical stack container (common column layout). */
export function buildVerticalStackPreset(): { props: Record<string, unknown> } {
    return {
        props: {
            layoutKind: "stack" as ContainerLayoutKind,
            stackDirection: "vertical" as ContainerStackDirection,
            stackGap: 8,
            stackAlignItems: "stretch",
            stackJustifyContent: "start",
        },
    };
}
