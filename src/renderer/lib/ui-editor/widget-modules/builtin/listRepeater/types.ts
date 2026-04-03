export type ListRepeaterDirection = "horizontal" | "vertical";

export type ListRepeaterWidgetProps = {
    /** Design-time number of repeated template rows/columns. */
    previewCount: number;
    /** Gap between repeated instances (main axis of repeat). */
    itemGap: number;
    /** Stack repeated copies vertically or horizontally. */
    repeatDirection: ListRepeaterDirection;
    /** Layout of template children inside each copy. */
    templateDirection: ListRepeaterDirection;
    templateGap: number;
};

export const defaultListRepeaterWidgetProps: ListRepeaterWidgetProps = {
    previewCount: 4,
    itemGap: 8,
    repeatDirection: "vertical",
    templateDirection: "vertical",
    templateGap: 4,
};
