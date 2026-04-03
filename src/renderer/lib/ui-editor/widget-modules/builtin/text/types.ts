export type TextAlign = "left" | "center" | "right";

export type TextWidgetProps = {
    text: string;
    fontSize: number;
    color: string;
    fontWeight: "normal" | "bold" | "600";
    textAlign: TextAlign;
    lineHeight: number;
};

export const defaultTextWidgetProps: TextWidgetProps = {
    text: "Text",
    fontSize: 16,
    color: "#e5e7eb",
    fontWeight: "normal",
    textAlign: "left",
    lineHeight: 1.4,
};
