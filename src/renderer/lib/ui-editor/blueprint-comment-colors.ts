/**
 * The four colours a comment card - and therefore a group frame - can be painted in.
 *
 * Shared rather than local to the card, because the toolbar has to offer the same four when a
 * group is created: a swatch there and the swatch on the frame it produces have to be the same
 * colour, and the only way to guarantee that is for there to be one list.
 *
 * Literal rgba rather than semantic tokens: these are the author's own labelling, the same kind of
 * user-chosen colour the character and palette editors carry, not interface chrome. Each entry is a
 * full set - a border, a brighter border for when the frame is selected, a translucent fill that
 * still reads as a region behind a graph, a title band, a text colour, and the solid swatch the
 * picker shows.
 *
 * Comments in English per project convention.
 */

import type { UseTranslation } from "@/lib/i18n";

export type BlueprintCommentColor = {
    border: string;
    selectedBorder: string;
    background: string;
    header: string;
    text: string;
    swatch: string;
};

export const BLUEPRINT_COMMENT_COLORS: Record<string, BlueprintCommentColor> = {
    amber: {
        border: "rgba(245, 158, 11, 0.55)",
        selectedBorder: "rgba(251, 191, 36, 0.95)",
        background: "rgba(120, 78, 18, 0.28)",
        header: "rgba(245, 158, 11, 0.2)",
        text: "#fde68a",
        swatch: "#f59e0b",
    },
    cyan: {
        border: "rgba(34, 211, 238, 0.55)",
        selectedBorder: "rgba(103, 232, 249, 0.95)",
        background: "rgba(8, 85, 102, 0.28)",
        header: "rgba(34, 211, 238, 0.18)",
        text: "#a5f3fc",
        swatch: "#06b6d4",
    },
    violet: {
        border: "rgba(167, 139, 250, 0.55)",
        selectedBorder: "rgba(196, 181, 253, 0.95)",
        background: "rgba(76, 29, 149, 0.26)",
        header: "rgba(167, 139, 250, 0.18)",
        text: "#ddd6fe",
        swatch: "#8b5cf6",
    },
    slate: {
        border: "rgba(148, 163, 184, 0.5)",
        selectedBorder: "rgba(203, 213, 225, 0.92)",
        background: "rgba(51, 65, 85, 0.32)",
        header: "rgba(148, 163, 184, 0.13)",
        text: "#e2e8f0",
        swatch: "#64748b",
    },
};

/** What a new group is painted in until the author picks otherwise. */
export const BLUEPRINT_COMMENT_DEFAULT_COLOR = "amber";

/** A stored `color` param narrowed to one of the four, so a stale or absent one still paints. */
export function resolveBlueprintCommentColorKey(key: unknown): string {
    return typeof key === "string" && BLUEPRINT_COMMENT_COLORS[key] ? key : BLUEPRINT_COMMENT_DEFAULT_COLOR;
}

/** Localized swatch names, keyed by the same ids as {@link BLUEPRINT_COMMENT_COLORS}. */
export function blueprintCommentColorLabel(key: string, t: UseTranslation["t"]): string {
    switch (key) {
        case "amber":
            return t("blueprint.comment.color.amber");
        case "cyan":
            return t("blueprint.comment.color.cyan");
        case "violet":
            return t("blueprint.comment.color.violet");
        case "slate":
            return t("blueprint.comment.color.slate");
        default:
            return key;
    }
}
