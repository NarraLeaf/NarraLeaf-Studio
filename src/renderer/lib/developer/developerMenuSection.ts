import type { ContextMenuDef, ContextMenuItemDef } from "@/lib/components/elements/ContextMenu";
import type { TranslationKey } from "@shared/i18n";
import { copyTextToClipboard } from "@/lib/app/diagnostics/copyText";
import { translate } from "@/lib/i18n";
import { isDeveloperModeEnabled } from "./developerMode";

/**
 * The section Developer options adds to the bottom of a context menu: one row per identifier the
 * right-clicked thing has, each putting it on the clipboard.
 *
 * One builder for every menu rather than a row written per panel, because the rows have to agree on
 * three things an author notices immediately: that they are always last, that they are always behind
 * one divider, and that they are always worded the same way. A panel that assembled its own would
 * drift on all three.
 *
 * Copying an identifier reads the document and nothing else, so the rows stay available in a frozen
 * workspace and while an old version is being viewed. A menu that goes through a freeze/read-only
 * walker (`freezeContextMenuRows`) therefore has to union {@link DEVELOPER_MENU_ROW_IDS} into its
 * exemption set, or the walker will grey out rows that write nothing.
 *
 * The preference is read here, as the menu is assembled. Every menu in the product is assembled when
 * it opens - opening one always moves state the menu is built from - so switching Developer options
 * in the Settings window shows up on the next right-click without anything else being subscribed.
 */

/**
 * What an identifier names. Fixed rather than caller-supplied so the wording of a row is decided
 * here, in one table, instead of at each of the call sites.
 */
export type DeveloperIdKind =
    | "surface"
    | "element"
    | "asset"
    | "assetGroup"
    | "character"
    | "characterGroup"
    | "story"
    | "chapter"
    | "scene"
    | "storyRow";

const COPY_LABEL_KEYS: Record<DeveloperIdKind, TranslationKey> = {
    surface: "developer.copyId.surface",
    element: "developer.copyId.element",
    asset: "developer.copyId.asset",
    assetGroup: "developer.copyId.assetGroup",
    character: "developer.copyId.character",
    characterGroup: "developer.copyId.characterGroup",
    story: "developer.copyId.story",
    chapter: "developer.copyId.chapter",
    scene: "developer.copyId.scene",
    storyRow: "developer.copyId.storyRow",
};

/**
 * One row's worth of input: what the identifier names, and the identifier.
 *
 * A surface carries its own noun because the interface has two of them - a Page and a Game UI are
 * both surfaces, and only the caller holding the surface knows which one this is. Requiring it here
 * rather than defaulting to one of the two is what stops a Game UI row from reading "Copy page ID".
 */
export type DeveloperIdEntry =
    | { kind: "surface"; value: string | null | undefined; label: string }
    | { kind: Exclude<DeveloperIdKind, "surface">; value: string | null | undefined };

export type DeveloperMenuSectionOptions = {
    /** Closes the menu before the copy runs; menus that close themselves on click may omit it. */
    hideMenu?: () => void;
    /**
     * How the result is announced. `UIService.showNotification` at every call site inside a
     * workspace; omitted where there is no notification host, in which case a copy is silent and a
     * failure is only logged.
     */
    notify?: (message: string, type: "success" | "error") => void;
};

/** The row id for a kind. Stable, so a read-only walker can name these rows as ones that stay live. */
export function developerCopyIdRowId(kind: DeveloperIdKind): string {
    return `developer-copy-${kind}-id`;
}

const ALL_KINDS = Object.keys(COPY_LABEL_KEYS) as DeveloperIdKind[];

/**
 * Every row id this module can produce, for the freeze/read-only exemption sets.
 *
 * Those sets name what KEEPS working (see `freezeContextMenuRows`), so a menu that goes through one
 * must union this in - otherwise a frozen project greys out a row that only reads.
 */
export const DEVELOPER_MENU_ROW_IDS: ReadonlySet<string> = new Set(ALL_KINDS.map(developerCopyIdRowId));

/** The separator that opens the section. Named so a menu can find it in a test. */
export const DEVELOPER_MENU_SEPARATOR_ID = "developer-separator";

function endsWithSeparator(items: ContextMenuDef): boolean {
    const last = items[items.length - 1];
    return Boolean(last && "separator" in last && last.separator);
}

function copyIdRow(entry: DeveloperIdEntry, options: DeveloperMenuSectionOptions): ContextMenuItemDef {
    const value = entry.value as string;
    const label = entry.kind === "surface"
        ? translate(COPY_LABEL_KEYS.surface, { label: entry.label })
        : translate(COPY_LABEL_KEYS[entry.kind]);

    return {
        id: developerCopyIdRowId(entry.kind),
        label,
        // The identifier itself, on hover: the row says what will be copied, and this says what that
        // is, without a menu that prints a line of hex under every entry.
        tooltip: value,
        onClick: () => {
            options.hideMenu?.();
            void copyTextToClipboard(value).then(
                () => {
                    options.notify?.(translate("developer.copied"), "success");
                },
                (error: unknown) => {
                    console.error("[developer] Failed to copy an identifier.", error);
                    options.notify?.(translate("developer.copyFailed"), "error");
                },
            );
        },
    };
}

/**
 * Return `items` with the developer section appended, or `items` untouched.
 *
 * Untouched in three cases, and all three matter: developer options are off, no entry carries an
 * identifier (a blank-area right-click), or the caller passed none. The separator is only added when
 * there is something above it to separate from, and never twice in a row.
 */
export function appendDeveloperIdSection(
    items: ContextMenuDef,
    entries: readonly DeveloperIdEntry[],
    options: DeveloperMenuSectionOptions = {},
): ContextMenuDef {
    if (!isDeveloperModeEnabled()) {
        return items;
    }

    const seen = new Set<DeveloperIdKind>();
    const rows: ContextMenuItemDef[] = [];
    for (const entry of entries) {
        if (typeof entry.value !== "string" || entry.value.length === 0 || seen.has(entry.kind)) {
            continue;
        }
        seen.add(entry.kind);
        rows.push(copyIdRow(entry, options));
    }

    if (rows.length === 0) {
        return items;
    }

    const separator: ContextMenuDef = items.length > 0 && !endsWithSeparator(items)
        ? [{ separator: true, id: DEVELOPER_MENU_SEPARATOR_ID }]
        : [];

    return [...items, ...separator, ...rows];
}
