import type { AppearanceModel, ButtonCursorValue } from "@shared/types/ui-editor/appearance";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import type { TextAlign, TextVerticalAlign, TextWrapMode } from "../text/types";

export type ButtonWidgetProps = {
    /** Button label; empty string keeps legacy buttons without visible text until set. */
    label: string;
    fontSize: number;
    color: string;
    fontWeight: "normal" | "bold" | "600";
    textAlign: TextAlign;
    textVerticalAlign: TextVerticalAlign;
    lineHeight: number;
    fontAssetId: string | null;
    textWrapMode: TextWrapMode;

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
    borderStyle: "solid" | "dashed" | "dotted" | "none";
    paddingX: number;
    paddingY: number;
    clipContent: boolean;
    cursor: ButtonCursorValue;

    transformOffsetX: number;
    transformOffsetY: number;
    transformScale: number;
    transformRotation: number;
    transformOpacity: number;

    /** Dev Mode / runtime: disables interaction without mutating saved props */
    interactionDisabled?: boolean;

    /** Optional variant + conditional row visuals; when absent, flat props are the sole source. */
    appearance?: AppearanceModel | null;
};

export const defaultButtonWidgetProps: ButtonWidgetProps = {
    label: "",
    fontSize: 16,
    color: "#e5e7eb",
    fontWeight: "normal",
    textAlign: "center",
    textVerticalAlign: "center",
    lineHeight: 1.4,
    fontAssetId: null,
    textWrapMode: "nowrap",

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
    cursor: "auto",

    transformOffsetX: 0,
    transformOffsetY: 0,
    transformScale: 1,
    transformRotation: 0,
    transformOpacity: 1,
};
