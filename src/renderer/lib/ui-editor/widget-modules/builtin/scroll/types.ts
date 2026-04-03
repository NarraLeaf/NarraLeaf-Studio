/** Single-axis scroll: content scrolls along one axis; the other axis clips. */
export type ScrollAxis = "x" | "y";

export type ScrollWidgetProps = {
    axis: ScrollAxis;
};

export const defaultScrollWidgetProps: ScrollWidgetProps = {
    axis: "y",
};
