import type { AppearanceModel } from "@shared/types/ui-editor/appearance";

export type ButtonWidgetProps = {
    backgroundColor: string;
    borderRadius: number;
    borderWidth: number;
    borderColor: string;
    borderStyle: "solid" | "dashed" | "none";
    paddingX: number;
    paddingY: number;
    clipContent: boolean;
    /** Dev Mode / runtime: disables interaction without mutating saved props */
    interactionDisabled?: boolean;

    /** Optional variant + conditional row visuals; when absent, flat props are the sole source. */
    appearance?: AppearanceModel | null;
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
