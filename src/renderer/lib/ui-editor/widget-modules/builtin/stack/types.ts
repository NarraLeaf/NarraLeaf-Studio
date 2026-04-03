export type StackDirection = "horizontal" | "vertical";

export type StackAlignItems = "start" | "center" | "end" | "stretch";

export type StackJustifyContent = "start" | "center" | "end" | "space-between" | "space-around";

export type StackWidgetProps = {
    direction: StackDirection;
    gap: number;
    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;
    alignItems: StackAlignItems;
    justifyContent: StackJustifyContent;
};

export const defaultStackWidgetProps: StackWidgetProps = {
    direction: "vertical",
    gap: 8,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    alignItems: "stretch",
    justifyContent: "start",
};
