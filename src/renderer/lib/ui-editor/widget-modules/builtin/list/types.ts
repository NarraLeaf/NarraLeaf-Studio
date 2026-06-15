export type ListDirection = "horizontal" | "vertical";

import type { ElementEffectValues } from "@shared/types/ui-editor/effects";
import { DEFAULT_ELEMENT_EFFECT_VALUES } from "@shared/types/ui-editor/effects";

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
    /** Static visual effects on the list host (no appearance / motion authoring). */
    effects: ElementEffectValues;
};

export const defaultListWidgetProps: ListWidgetProps = {
    previewCount: 4,
    itemGap: 8,
    repeatDirection: "vertical",
    templateDirection: "vertical",
    templateGap: 4,
    effects: { ...DEFAULT_ELEMENT_EFFECT_VALUES },
};
