export type ListDirection = "horizontal" | "vertical";

import type { ElementEffectValues } from "@shared/types/ui-editor/effects";
import { DEFAULT_ELEMENT_EFFECT_VALUES } from "@shared/types/ui-editor/effects";
import type { TextWritingMode } from "@/lib/ui-editor/widget-modules/shared/text/verticalTypography";
import type { UIPageAnimationSettings } from "@shared/types/ui-editor/pageAnimation";
import type {
    UIListItemsBinding,
    UIListScrollbarPartStyle,
    UIListScrollbarProps,
} from "@shared/types/ui-editor/list";

export type ListWidgetProps = {
    /** Runtime data source. With none, the list draws its authored items. */
    itemsBinding?: UIListItemsBinding | null;
    /**
     * The shape of one item, by id into the document's struct library.
     *
     * Everything an author touches about item data reads this: the content table's columns, the
     * field picker on a child element's value binding, the typed pins on the item nodes. A list
     * with none declared still runs - its items are whatever a graph wrote - but nothing can be
     * offered in a dropdown, which is the state this model exists to get out of.
     */
    itemStructId?: string | null;
    /**
     * The content the author wrote, shaped by `itemStructId`.
     *
     * One list, not a preview copy and a shipped copy: what is drawn on the canvas is what the game
     * starts with. A binding or a graph write replaces it at runtime; until then this is the list.
     */
    items: unknown[];
    /** Field whose value keys a row, so a row keeps its identity across edits. Empty keys by index. */
    itemKeyFieldId?: string | null;
    /** How many empty rows to draw when there is no content at all - authored, bound or written. */
    placeholderCount: number;
    /** Current selected item index. -1 means no selection. */
    selectedIndex: number;
    /** Gap between list items (main axis of repeat). */
    itemGap: number;
    /** Stack preview copies vertically or horizontally. */
    repeatDirection: ListDirection;
    /**
     * Whether items that do not fit along `repeatDirection` continue on a further line.
     *
     * This is the list's second axis, and it is the list that lays it out: items flow along the
     * repeat direction, break when the box runs out, and the lines pack against the start of the
     * cross axis with `itemGap` between them - a grid, from a list of items and one item template.
     *
     * It also turns the axis the list scrolls along. Items no longer run off the end of the repeat
     * direction, so there is nothing to scroll there; what grows is the stack of lines, across it.
     */
    repeatWrap: boolean;
    /**
     * Block flow of the list.
     *
     * A vertical mode turns the whole list, not only the glyphs inside it: `repeatDirection` is read
     * against the writing mode, so a full-screen dialogue whose lines are set vertically stacks them
     * right to left the way the writing runs, and scrolls along that axis. Inherited by everything
     * inside the items, which is what makes the text in them vertical without being set twice.
     */
    writingMode: TextWritingMode;
    contentPaddingTop: number;
    contentPaddingRight: number;
    contentPaddingBottom: number;
    contentPaddingLeft: number;
    /**
     * How a row arrives and leaves, and how far apart successive rows are staggered.
     *
     * The element animation record, because a row arrives and leaves exactly the way anything else
     * on a Surface does; `childStaggerSeconds` is read as the gap between one row and the next, which
     * is the same sentence it means on a container. Null is "rows appear and disappear", which is
     * what every list did before and what a list showing a static menu still wants.
     */
    itemAnimation?: UIPageAnimationSettings | null;
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
    itemStructId: null,
    items: [],
    itemKeyFieldId: null,
    placeholderCount: 4,
    itemAnimation: null,
    selectedIndex: -1,
    itemGap: 8,
    repeatDirection: "vertical",
    repeatWrap: false,
    writingMode: "horizontal-tb",
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
