export type ListDirection = "horizontal" | "vertical";

export type ListWidgetProps = {
    /** Design-time number of preview rows/columns. */
    previewCount: number;
    /** Gap between list items (main axis of repeat). */
    itemGap: number;
    /** Stack preview copies vertically or horizontally. */
    repeatDirection: ListDirection;
    /** Layout of template children inside each item. */
    templateDirection: ListDirection;
    templateGap: number;
};

export const defaultListWidgetProps: ListWidgetProps = {
    previewCount: 4,
    itemGap: 8,
    repeatDirection: "vertical",
    templateDirection: "vertical",
    templateGap: 4,
};
