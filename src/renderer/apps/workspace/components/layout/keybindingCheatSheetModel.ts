import type { TranslationKey } from "@shared/i18n";
import { compileMatcher, type CompiledMatcher, type TextRange } from "@/lib/workspace/services/search/textMatcher";
import { formatKeybinding } from "@/lib/workspace/services/ui/keybindingFormat";
import {
    getKeybindingCatalogEntry,
    KEYBINDING_CATALOG,
    KEYBINDING_CATEGORY,
} from "@/lib/workspace/services/ui/keybindingCatalog";
import {
    FIXED_INPUT_CATALOG,
    formatFixedInput,
    getFixedInputsExtending,
    resolveFixedInputDisplay,
    type FixedInput,
} from "@/lib/workspace/services/ui/fixedInputCatalog";

/**
 * What the "?" cheat sheet shows, kept apart from the overlay so the three questions it answers can be
 * tested without a workspace: what every group holds, which of it works where focus is now, and which
 * of it a query finds.
 */

type Translate = (key: TranslationKey, params?: Record<string, string>) => string;

export const OTHER_GROUP_KEY = "other";
/** The section pinned above the groups: what works where focus is. */
export const FOCUSED_GROUP_KEY = "focused";

/**
 * Groups that are never "the editor in front of you": they apply everywhere, so they say nothing about
 * where the author is. Their bindings with a `when` (Run's follow the run state, close-tab follows any
 * editor) would otherwise put the same few rows at the top of every sheet.
 *
 * A set of `string`, not of `TranslationKey`: the newer `Set` typings carry generic methods
 * (`union`, `intersection`), and relating a `Set` over the union of every catalog key to a
 * `ReadonlySet` of the same exhausts the compiler's relation cache and crashes `tsc`.
 */
const WORKSPACE_WIDE_CATEGORIES: ReadonlySet<string> = new Set<string>([
    KEYBINDING_CATEGORY.general,
    KEYBINDING_CATEGORY.run,
    KEYBINDING_CATEGORY.view,
]);

export interface SheetRow {
    /** The catalog id of a binding, `fixed:<id>` for a fixed input, or a live registration's id. */
    id: string;
    name: string;
    /** Every way to run the row's command, as drawn: its chord first, then any gestures that do the same. */
    inputs: string[];
    /**
     * The same inputs spelled the way an author types them into a search box: the chord as words
     * ("Cmd+Shift+Z" on macOS, where the chip draws ⇧⌘Z) and as declared ("mod+shift+z", "arrowup",
     * "escape"). Searched, never drawn.
     */
    typedInputs: string;
    /** Fixed inputs only: the binding whose being live puts this row under where focus is. */
    liveWith?: string;
    fixed?: boolean;
}

export interface SheetGroup {
    key: string;
    title: string;
    rows: SheetRow[];
}

/** A registration the dispatcher holds, as far as the sheet reads one. */
export interface RegisteredBinding {
    id: string;
    key: string;
    catalogId?: string;
    description?: string;
}

export interface SheetSources {
    t: Translate;
    isMac: boolean;
    /** The chord that fires: the author's override, else the catalog default, else the inline key. */
    effectiveKey: (binding: RegisteredBinding) => string;
    /** Live registrations, for the described ones the catalog does not list. */
    registered: readonly RegisteredBinding[];
}

const MAC_MODIFIER_WORDS: Record<string, string> = {
    mod: "Cmd",
    cmd: "Cmd",
    meta: "Cmd",
    super: "Cmd",
    ctrl: "Ctrl",
    control: "Ctrl",
    alt: "Option",
    option: "Option",
    shift: "Shift",
};

/**
 * A chord in words. Elsewhere this is exactly the chip ("Ctrl+Shift+Z"); on macOS the chip is glyphs
 * (⇧⌘Z), which nobody types, so the words are what a query has to meet.
 */
export function chordInWords(binding: string, isMac: boolean): string {
    if (!isMac) {
        return formatKeybinding(binding, false);
    }
    return binding
        .toLowerCase()
        .split("+")
        .map(part => MAC_MODIFIER_WORDS[part] ?? formatKeybinding(part, false))
        .join("+");
}

function typedFormsOf(inputs: readonly FixedInput[], chords: readonly string[], isMac: boolean): string {
    const forms: string[] = [];
    for (const chord of chords) {
        forms.push(chordInWords(chord, isMac), chord);
    }
    for (const input of inputs) {
        if ("key" in input) {
            forms.push(chordInWords(input.key, isMac), input.key);
        } else if (input.modifiers) {
            forms.push(chordInWords(input.modifiers, isMac));
        }
    }
    return forms.join("\n");
}

/**
 * Every group the sheet lists, in the catalog's order: each binding under its editor's group with the
 * gestures that run the same command beside its chord, then the fixed inputs filed under the same
 * groups, then described live registrations the catalog does not know ("Other"). The sheet lists
 * everything, whether or not its editor is open.
 */
export function buildSheetGroups(sources: SheetSources): SheetGroup[] {
    const { t, isMac } = sources;
    const groups: SheetGroup[] = [];
    const push = (key: string, title: string, row: SheetRow) => {
        const group = groups.find(candidate => candidate.key === key);
        if (group) {
            group.rows.push(row);
        } else {
            groups.push({ key, title, rows: [row] });
        }
    };
    const format = (input: FixedInput) => formatFixedInput(input, isMac, t);

    const catalogIds = new Set<string>();
    for (const entry of KEYBINDING_CATALOG) {
        catalogIds.add(entry.id);
        const chord = sources.effectiveKey({ id: entry.id, key: entry.key });
        const gestures = getFixedInputsExtending(entry.id);
        push(entry.categoryKey, t(entry.categoryKey), {
            id: entry.id,
            name: t(entry.labelKey),
            inputs: [formatKeybinding(chord, isMac), ...gestures.map(format)],
            typedInputs: typedFormsOf(gestures, [chord], isMac),
        });
    }

    for (const item of FIXED_INPUT_CATALOG) {
        if (item.extends) {
            continue;
        }
        const display = resolveFixedInputDisplay(item);
        if (!display) {
            continue;
        }
        push(display.categoryKey, t(display.categoryKey), {
            id: `fixed:${item.id}`,
            name: t(display.labelKey),
            inputs: item.inputs.map(format),
            typedInputs: typedFormsOf(item.inputs, [], isMac),
            liveWith: item.liveWith,
            fixed: true,
        });
    }

    const otherTitle = t("workspace.shell.keybindings.categories.other");
    const seen = new Set<string>();
    for (const binding of sources.registered) {
        const catalogId = binding.catalogId ?? binding.id;
        if (catalogIds.has(catalogId) || seen.has(catalogId) || !binding.description?.trim()) {
            continue;
        }
        seen.add(catalogId);
        const chord = sources.effectiveKey(binding);
        push(OTHER_GROUP_KEY, otherTitle, {
            id: catalogId,
            name: binding.description.trim(),
            inputs: [formatKeybinding(chord, isMac)],
            typedInputs: typedFormsOf([], [chord], isMac),
        });
    }
    return groups;
}

/**
 * What works where focus is, as one group to pin above the rest, or null when focus is on nothing
 * with keys of its own (the dashboard, a panel without shortcuts).
 *
 * `focusedIds` is the dispatcher's answer (`KeybindingService.getFocusedCatalogIds`): the bindings
 * whose `when` admits the current focus. A binding row is in when its id is live. A gesture cannot be
 * live, so it follows its group: in when that group has a live binding, or, for a group that spans
 * several surfaces, when the binding it names in `liveWith` is.
 *
 * The title names the group with the most live bindings - the editor or panel in front of the author.
 */
export function buildFocusedGroup(groups: readonly SheetGroup[], focusedIds: readonly string[], t: Translate): SheetGroup | null {
    const live = new Set(focusedIds);
    const liveCount = new Map<string, number>();
    for (const id of live) {
        const category = getKeybindingCatalogEntry(id)?.categoryKey;
        if (category && !WORKSPACE_WIDE_CATEGORIES.has(category)) {
            liveCount.set(category, (liveCount.get(category) ?? 0) + 1);
        }
    }

    const rows: SheetRow[] = [];
    for (const group of groups) {
        if (WORKSPACE_WIDE_CATEGORIES.has(group.key)) {
            continue;
        }
        for (const row of group.rows) {
            const inFocus = row.fixed
                ? row.liveWith ? live.has(row.liveWith) : liveCount.has(group.key)
                : live.has(row.id);
            if (inFocus) {
                rows.push(row);
            }
        }
    }
    if (rows.length === 0) {
        return null;
    }

    let lead: string | null = null;
    for (const [category, count] of liveCount) {
        if (lead === null || count > (liveCount.get(lead) ?? 0)) {
            lead = category;
        }
    }
    const name = lead
        ? t(lead as TranslationKey)
        : t("workspace.shell.keybindings.categories.other");
    return {
        key: FOCUSED_GROUP_KEY,
        title: t("workspace.shell.keybindings.cheatSheetFocused", { name }),
        rows,
    };
}

/**
 * The groups without the rows pinned above them, so a row is listed once: at the top while it works
 * where focus is, in its group otherwise. A group left empty (the editor in front of the author,
 * when every one of its keys is live) is dropped.
 */
export function withoutPinned(groups: readonly SheetGroup[], pinned: SheetGroup | null): SheetGroup[] {
    if (!pinned) {
        return [...groups];
    }
    const ids = new Set(pinned.rows.map(row => row.id));
    const result: SheetGroup[] = [];
    for (const group of groups) {
        const rows = group.rows.filter(row => !ids.has(row.id));
        if (rows.length > 0) {
            result.push(rows.length === group.rows.length ? group : { ...group, rows });
        }
    }
    return result;
}

/**
 * A query compiled for the sheet: whitespace-separated terms, each read literally and without regard
 * to case, every one of which has to occur somewhere in a row - its name, its inputs, or its group's
 * title, so "blueprint" lists the Blueprint Editor and "blueprint paste" its paste.
 *
 * `marks` is the union of every term's hits, in the shape the find surfaces paint
 * (`markedFragments`), so a hit in the sheet looks like a hit anywhere else in Studio.
 */
export interface SheetQuery {
    terms: CompiledMatcher[];
    marks: CompiledMatcher;
}

const LITERAL = { caseSensitive: false, wholeWord: false, regex: false } as const;

export function compileSheetQuery(query: string): SheetQuery | null {
    const terms = query
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(term => compileMatcher(term, LITERAL));
    if (terms.length === 0) {
        return null;
    }
    const findRanges = (text: string): TextRange[] => mergeRanges(terms.flatMap(term => term.findRanges(text)));
    return {
        terms,
        marks: {
            findRanges,
            test: text => terms.some(term => term.test(text)),
            expand: (_text, _range, replacement) => replacement,
        },
    };
}

/** Overlapping and touching hits as one, in order, so no character is wrapped in two marks. */
function mergeRanges(ranges: TextRange[]): TextRange[] {
    const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: TextRange[] = [];
    for (const range of sorted) {
        const last = merged[merged.length - 1];
        if (last && range.start <= last.end) {
            last.end = Math.max(last.end, range.end);
        } else {
            merged.push({ ...range });
        }
    }
    return merged;
}

/** The rows of each group that the query finds; groups left empty are dropped. */
export function filterSheetGroups(groups: readonly SheetGroup[], query: SheetQuery | null): SheetGroup[] {
    if (!query) {
        return [...groups];
    }
    const result: SheetGroup[] = [];
    for (const group of groups) {
        const rows = group.rows.filter(row => {
            const text = [group.title, row.name, ...row.inputs, row.typedInputs].join("\n");
            return query.terms.every(term => term.test(text));
        });
        if (rows.length > 0) {
            result.push({ ...group, rows });
        }
    }
    return result;
}
