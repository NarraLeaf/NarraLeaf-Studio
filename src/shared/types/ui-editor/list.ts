import type { ImageFill } from "./imageFill";

export type UIListChildSlot = "itemTemplate" | "scrollbarTrack" | "scrollbarThumb";

export type UIListElementExtra = {
    listSlot?: UIListChildSlot;
    runtimeVariantOverrideId?: string;
};

export type UIListItemsBinding =
    | { kind: "surfaceState"; key: string }
    | { kind: "globalState"; key: string };

export type UIListItemScope = {
    item: unknown;
    index: number;
    count: number;
    key: string;
};

export type UIListScrollbarVisibility = "auto" | "always" | "hidden";
export type UIListScrollbarSide = "right" | "left" | "bottom" | "top";

export type UIListScrollbarPartStyle = {
    backgroundColor: string;
    fillType: "color" | "image";
    imageFill?: ImageFill | null;
    backgroundImage: string;
    backgroundFit: string;
    fillOpacity: number;
    borderRadius: number;
    borderColor: string;
    borderWidth: number;
    borderStyle: string;
};

export type UIListScrollbarProps = {
    enabled: boolean;
    side: UIListScrollbarSide;
    visibility: UIListScrollbarVisibility;
    thickness: number;
    contentInset: number;
    minThumbLength: number;
    trackStyle: UIListScrollbarPartStyle;
    thumbStyle: UIListScrollbarPartStyle;
    trackElementId?: string | null;
    thumbElementId?: string | null;
};

export function getUIListChildSlot(extra: Record<string, unknown> | undefined): UIListChildSlot | null {
    const slot = extra?.listSlot;
    return slot === "itemTemplate" || slot === "scrollbarTrack" || slot === "scrollbarThumb" ? slot : null;
}

export function isUIListScrollbarSlot(slot: UIListChildSlot | null): boolean {
    return slot === "scrollbarTrack" || slot === "scrollbarThumb";
}

