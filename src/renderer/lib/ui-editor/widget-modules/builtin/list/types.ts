export type ListDirection = "horizontal" | "vertical";

import type { ElementEffectValues } from "@shared/types/ui-editor/effects";
import { DEFAULT_ELEMENT_EFFECT_VALUES } from "@shared/types/ui-editor/effects";
import type {
    UIListItemsBinding,
    UIListScrollbarPartStyle,
    UIListScrollbarProps,
} from "@shared/types/ui-editor/list";

export type ListWidgetProps = {
    /** Runtime data source. Workspace preview falls back to previewItems / previewCount. */
    itemsBinding?: UIListItemsBinding | null;
    /** Design-time sample items. Objects are exposed through listItem.* bindings. */
    previewItems: unknown[];
    /** Dot path used to produce stable per-row keys from item objects. */
    itemKeyPath?: string;
    /** Design-time number of preview rows/columns. */
    previewCount: number;
    /** Gap between list items (main axis of repeat). */
    itemGap: number;
    /** Stack preview copies vertically or horizontally. */
    repeatDirection: ListDirection;
    contentPaddingTop: number;
    contentPaddingRight: number;
    contentPaddingBottom: number;
    contentPaddingLeft: number;
    /** Layout of template children inside each item. */
    templateDirection: ListDirection;
    templateGap: number;
    /** Allow pointer-dragging the list viewport content to scroll naturally. */
    dragContentScroll: boolean;
    /** List-owned scrollbar style / authored part ids. */
    scrollbar: UIListScrollbarProps;
    /** Static visual effects on the list host (no appearance / motion authoring). */
    effects: ElementEffectValues;
};

export const defaultListScrollbarPartStyle: UIListScrollbarPartStyle = {
    backgroundColor: "transparent",
    fillType: "color",
    imageFill: null,
    backgroundImage: "",
    backgroundFit: "cover",
    fillOpacity: 1,
    borderRadius: 999,
    borderColor: "transparent",
    borderWidth: 0,
    borderStyle: "solid",
};

export const defaultListScrollbarProps: UIListScrollbarProps = {
    enabled: true,
    side: "right",
    visibility: "auto",
    thickness: 8,
    contentInset: 4,
    minThumbLength: 24,
    trackStyle: {
        ...defaultListScrollbarPartStyle,
        backgroundColor: "#ffffff",
        fillOpacity: 0.08,
    },
    thumbStyle: {
        ...defaultListScrollbarPartStyle,
        backgroundColor: "#ffffff",
        fillOpacity: 0.34,
    },
    trackElementId: null,
    thumbElementId: null,
};

export const defaultListWidgetProps: ListWidgetProps = {
    itemsBinding: null,
    previewItems: [],
    itemKeyPath: "id",
    previewCount: 4,
    itemGap: 8,
    repeatDirection: "vertical",
    contentPaddingTop: 0,
    contentPaddingRight: 0,
    contentPaddingBottom: 0,
    contentPaddingLeft: 0,
    templateDirection: "vertical",
    templateGap: 4,
    dragContentScroll: false,
    scrollbar: defaultListScrollbarProps,
    effects: { ...DEFAULT_ELEMENT_EFFECT_VALUES },
};
