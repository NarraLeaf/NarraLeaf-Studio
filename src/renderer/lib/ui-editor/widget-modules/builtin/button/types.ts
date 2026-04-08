import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";

export type ButtonWidgetProps = {
    backgroundColor: string;
    /** Flat fill baseline; appearance overlays may override per variant / state. */
    fillType: "color" | "image";
    fillOpacity: number;
    fillVisible: boolean;
    imageFill?: ImageFill | null;
    backgroundImage: string;
    backgroundFit: string;
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
    fillType: "color",
    fillOpacity: 1,
    fillVisible: true,
    imageFill: undefined,
    backgroundImage: "",
    backgroundFit: "cover",
    borderRadius: 8,
    borderWidth: 0,
    borderColor: "#000000",
    borderStyle: "none",
    paddingX: 16,
    paddingY: 10,
    clipContent: true,
};
