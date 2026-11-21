/**
 * The five text levels every Studio surface draws its headings and labels from (docs/design-system.md §4.1).
 *
 * Two densities share the levels. `panel` is the side panels, the inspector and the editors' own
 * chrome; `page` is the settings window, dialogs, the dashboard and the launcher. A level is the same
 * role in both, at the size its density reads at.
 *
 * - `title`: a panel header, a window or dialog title.
 * - `section`: the name of a group of fields or settings.
 * - `item`: one setting, one card, one entry in a list.
 * - `label`: the name above or beside a control.
 * - `meta`: a one-line expectation, a count, a size, a time.
 *
 * The rules the classes encode:
 * - `title`, `section` and `item` are `text-fg`. Only `label` and `meta` are muted, so a heading is
 *   never quieter than what it heads.
 * - Two neighbouring levels differ in at least two of size, weight, colour, spacing and container.
 *   `section` and `item` share a size in each density; the weight and the divider above a section
 *   tell them apart.
 * - One level, one look. A collapsible section is a `section` with a chevron, not a filled bar.
 */
export type TextDensity = "panel" | "page";

export type TextLevel = "title" | "section" | "item" | "label" | "meta";

export const TEXT_LEVEL_CLASS: Readonly<Record<TextDensity, Readonly<Record<TextLevel, string>>>> = {
    panel: {
        title: "text-sm font-semibold text-fg",
        section: "text-xs font-semibold text-fg",
        item: "text-xs text-fg",
        label: "text-2xs text-fg-muted",
        meta: "text-2xs text-fg-subtle",
    },
    page: {
        title: "text-base font-semibold text-fg",
        section: "text-sm font-semibold text-fg",
        item: "text-sm text-fg",
        label: "text-xs text-fg-muted",
        meta: "text-xs text-fg-subtle",
    },
};

/** The class for one level at one density. */
export function textLevelClass(level: TextLevel, density: TextDensity = "panel"): string {
    return TEXT_LEVEL_CLASS[density][level];
}
