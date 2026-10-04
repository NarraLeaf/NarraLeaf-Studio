import {
    defaultContainerWidgetProps,
    type ContainerWidgetProps,
} from "@shared/types/ui-editor/container";
import { createInitialContainerAppearance } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";

/** How a group sitting in a stack lays its own children out: the stack's way, on one line. */
export type GroupFlowLayout = Pick<ContainerWidgetProps, "stackDirection" | "stackGap" | "stackAlignItems">;

/**
 * The props of the container Group wraps a selection in.
 *
 * It has nothing of its own to see - no fill, no stroke - and does not clip, so wrapping elements in
 * it changes nothing on screen. In a free parent it is a free container; in a stack it is a stack
 * with that stack's direction, gap and alignment, so the wrapped children keep laying out the way
 * they did. The appearance model is seeded from these flat props, which is what the renderer reads.
 */
export function createGroupContainerProps(flow: GroupFlowLayout | null): Record<string, unknown> {
    const props: ContainerWidgetProps = {
        ...defaultContainerWidgetProps,
        fillVisible: false,
        strokeVisible: false,
        clipContent: false,
        ...(flow
            ? {
                  layoutKind: "stack",
                  stackDirection: flow.stackDirection,
                  stackGap: flow.stackGap,
                  stackAlignItems: flow.stackAlignItems,
                  stackJustifyContent: "start",
                  stackWrap: false,
              }
            : { layoutKind: "free" }),
    };
    return { ...props, appearance: createInitialContainerAppearance(props) };
}
