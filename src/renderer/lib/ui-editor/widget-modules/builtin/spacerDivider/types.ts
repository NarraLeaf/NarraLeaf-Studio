export type SpacerDividerMode = "spacer" | "divider";

/** Divider line orientation: horizontal rule vs vertical rule inside the widget box. */
export type SpacerDividerOrientation = "horizontal" | "vertical";

export type SpacerDividerWidgetProps = {
    mode: SpacerDividerMode;
    orientation: SpacerDividerOrientation;
    /** Line thickness (divider) or fixed cross-axis size hint (spacer), in px. */
    thickness: number;
    /** Divider line color (hex). */
    color: string;
    insetStart: number;
    insetEnd: number;
};

export const defaultSpacerDividerWidgetProps: SpacerDividerWidgetProps = {
    mode: "spacer",
    orientation: "horizontal",
    thickness: 12,
    color: "#444444",
    insetStart: 0,
    insetEnd: 0,
};
