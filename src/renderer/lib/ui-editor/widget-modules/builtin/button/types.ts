export type ButtonWidgetProps = {
    backgroundColor: string;
    borderRadius: number;
    borderWidth: number;
    borderColor: string;
    borderStyle: "solid" | "dashed" | "none";
    paddingX: number;
    paddingY: number;
    clipContent: boolean;
};

export const defaultButtonWidgetProps: ButtonWidgetProps = {
    backgroundColor: "#374151",
    borderRadius: 8,
    borderWidth: 0,
    borderColor: "#000000",
    borderStyle: "none",
    paddingX: 16,
    paddingY: 10,
    clipContent: true,
};
