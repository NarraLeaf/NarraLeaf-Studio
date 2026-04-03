export type ContainerWidgetProps = {
    backgroundColor: string;
    borderRadius: number;
    borderWidth: number;
    borderColor: string;
    borderStyle: "solid" | "dashed" | "none";
    clipContent: boolean;
};

export const defaultContainerWidgetProps: ContainerWidgetProps = {
    backgroundColor: "transparent",
    borderRadius: 0,
    borderWidth: 1,
    borderColor: "#ffffff33",
    borderStyle: "solid",
    clipContent: true,
};
