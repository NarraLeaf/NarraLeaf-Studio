import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Keyboard } from "lucide-react";
import { useWorkspace } from "../../context";
import { useKeybinding } from "../../hooks";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { KEYBINDING_OVERRIDES_SETTINGS_KEY } from "@/lib/workspace/services/ui/KeybindingService";
import type { CompiledMatcher } from "@/lib/workspace/services/search/textMatcher";
import { isMacPlatform } from "@/lib/app/platform";
import { getInterface } from "@/lib/app/bridge";
import { useFloatingLayer } from "@/lib/components/layout";
import { Button } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { SearchBox } from "../../modules/assets/components/SearchBox";
import { markedFragments } from "../ui/FindMarks";
import {
    buildFocusedGroup,
    buildSheetGroups,
    compileSheetQuery,
    filterSheetGroups,
    FOCUSED_GROUP_KEY,
    withoutPinned,
    type SheetGroup,
    type SheetRow,
} from "./keybindingCheatSheetModel";

/**
 * Reveal the keyboard-shortcut table, which lives in the Settings window under Shortcuts. Main
 * focuses an already-open Settings window rather than opening a second one, so this is safe to
 * call from every surface that offers "customize shortcuts".
 */
function openKeybindingSettings(): void {
    void getInterface().app.launchSettings({ highlight: KEYBINDING_OVERRIDES_SETTINGS_KEY });
}

// Module-level opener so surfaces outside this tree (the status bar's keyboard icon) can show
// the sheet. Same pattern as commandPaletteController: one window-local function pointer.
let cheatSheetOpener: (() => void) | null = null;

/** Open the keyboard cheat sheet (no-op until the workspace layout has mounted it). */
export function openKeybindingCheatSheet(): void {
    cheatSheetOpener?.();
}

/** A key or gesture as the sheet draws it. */
const CHIP_CLASS = "whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs tabular-nums";

/**
 * The "?" cheat sheet: a read-only overlay generated straight from the keybinding registry (every
 * described binding, actions' shortcuts included, with user overrides applied) and from the
 * fixed-input catalog, which holds the mouse gestures and the keys that cannot be rebound. Both are
 * filed under the same per-editor groups, so an editor's keys and its gestures read as one section.
 * Registered here too: the "Customize Keyboard Shortcuts" command that opens the settings tab — the
 * two surfaces belong together.
 *
 * What works where focus is comes first, in a section of its own above the groups, so the answer to
 * "what can I do here" is the first thing on screen. A row pinned there leaves its group, so every
 * row is listed once; the groups below never change order. The search
 * box takes focus on open: a name, a key ("ctrl+z", "f5") or a group narrows every section at once.
 *
 * `?` toggles it (never while typing — the binding is not `allowInEditable`); Esc or a backdrop
 * click closes.
 */
export function KeybindingCheatSheet() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    // The bindings live where focus was when the sheet opened. Read before it opens, while focus still
    // describes the workspace rather than the sheet.
    const [focusedIds, setFocusedIds] = useState<readonly string[]>([]);
    // Re-read the registry when overrides change while the sheet is open.
    const [revision, setRevision] = useState(0);
    const isMac = isMacPlatform();
    const scrollRef = useRef<HTMLDivElement>(null);

    const openSheet = useCallback(() => {
        setFocusedIds(context ? context.services.get<UIService>(Services.UI).keybindings.getFocusedCatalogIds() : []);
        setQuery("");
        setOpen(true);
    }, [context]);

    useKeybinding({
        id: "workspace-keybinding-cheatsheet",
        // shift+? (not shift+/): the browser reports the shifted character as the key.
        key: "shift+?",
        description: "Show keyboard shortcuts",
        handler: () => {
            if (open) {
                setOpen(false);
            } else {
                openSheet();
            }
        },
    });

    useEffect(() => {
        cheatSheetOpener = openSheet;
        return () => {
            cheatSheetOpener = null;
        };
    }, [openSheet]);

    // The palette-facing command to open the customization surface.
    useEffect(() => {
        if (!context) {
            return;
        }
        const commandService = context.services.get<CommandService>(Services.Command);
        return commandService.register({
            id: "workspace:open-keybindings",
            titleKey: "workspace.shell.keybindings.openSettings",
            categoryKey: "workspace.shell.commandPalette.categoryPreferences",
            icon: <Keyboard className="w-4 h-4" />,
            run: () => openKeybindingSettings(),
        });
    }, [context]);

    useEffect(() => {
        if (!open || !context) {
            return;
        }
        const uiService = context.services.get<UIService>(Services.UI);
        return uiService.keybindings.onOverridesChanged(() => setRevision(value => value + 1));
    }, [open, context]);

    // The sheet dims the window and sits over it, so it is a trapped layer: focus moves onto it when
    // it opens, Tab cannot walk out to the page behind it, Escape closes it, and closing gives focus
    // back to whatever had it.
    const panelRef = useRef<HTMLDivElement>(null);
    useFloatingLayer({
        open,
        onClose: () => setOpen(false),
        panelRef,
        scope: "trap",
    });

    // Every group, built from the catalog with the author's overrides applied. Rebuilt per opening, so
    // an editor's own registrations ("Other") are the ones live now.
    const groups = useMemo((): SheetGroup[] => {
        if (!open || !context) {
            return [];
        }
        void revision;
        const keybindings = context.services.get<UIService>(Services.UI).keybindings;
        return buildSheetGroups({
            t,
            isMac,
            effectiveKey: binding => keybindings.getEffectiveKey(binding),
            registered: keybindings.getAll(),
        });
    }, [open, context, revision, t, isMac]);

    const focusedGroup = useMemo(() => buildFocusedGroup(groups, focusedIds, t), [groups, focusedIds, t]);
    const restGroups = useMemo(() => withoutPinned(groups, focusedGroup), [groups, focusedGroup]);

    const sheetQuery = useMemo(() => compileSheetQuery(query), [query]);
    const visibleFocused = useMemo(
        () => (focusedGroup ? (filterSheetGroups([focusedGroup], sheetQuery)[0] ?? null) : null),
        [focusedGroup, sheetQuery],
    );
    const visibleGroups = useMemo(() => filterSheetGroups(restGroups, sheetQuery), [restGroups, sheetQuery]);
    const marks = sheetQuery?.marks ?? null;

    // A new query starts reading from the top, where its first hit is.
    useLayoutEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = 0;
        }
    }, [query]);

    if (!open) {
        return null;
    }

    const nothingFound = !visibleFocused && visibleGroups.length === 0;

    return (
        <div className="nl-window-content-layer z-50 flex items-center justify-center p-6">
            <div
                className="absolute inset-0 bg-black/30 animate-fade-in"
                onMouseDown={() => setOpen(false)}
            />
            {/* Full height whatever the query leaves, so the search box stays where it is while typing. */}
            <div
                ref={panelRef}
                role="dialog"
                aria-label={t("workspace.shell.keybindings.cheatSheetTitle")}
                className="relative flex h-full w-[min(760px,calc(100vw-48px))] flex-col overflow-hidden rounded-md border border-edge bg-surface-raised shadow-2xl"
            >
                <div className="flex shrink-0 items-center gap-3 border-b border-edge px-4 py-3">
                    <h2 className="shrink-0 text-lg font-semibold text-fg">
                        {t("workspace.shell.keybindings.cheatSheetTitle")}
                    </h2>
                    <SearchBox
                        size="sm"
                        value={query}
                        onChange={setQuery}
                        placeholder={t("workspace.shell.keybindings.searchPlaceholder")}
                        className="ml-auto min-w-0 max-w-80 flex-1"
                    />
                    <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        onClick={() => {
                            setOpen(false);
                            openKeybindingSettings();
                        }}
                    >
                        {t("workspace.shell.keybindings.cheatSheetCustomize")}
                    </Button>
                </div>
                <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
                    {visibleFocused && (
                        <section
                            data-cheat-sheet-group={FOCUSED_GROUP_KEY}
                            className="mb-2 rounded-md border border-primary/30 bg-primary/10 px-3 pb-2"
                        >
                            <h3 className="pt-2.5 pb-1 text-base font-semibold text-primary">
                                {markedFragments(visibleFocused.title, marks)}
                            </h3>
                            <SheetRows rows={visibleFocused.rows} marks={marks} focused />
                        </section>
                    )}
                    {visibleGroups.map(group => (
                        <section key={group.key} data-cheat-sheet-group={group.key}>
                            <h3 className="pt-4 pb-1 text-base font-semibold text-fg">
                                {markedFragments(group.title, marks)}
                            </h3>
                            <SheetRows rows={group.rows} marks={marks} />
                        </section>
                    ))}
                    {nothingFound && (
                        <div className="py-10 text-center text-sm text-fg-subtle">
                            {t("workspace.shell.keybindings.empty")}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/** One group's rows, two columns wide when the window allows. */
function SheetRows({ rows, marks, focused = false }: {
    rows: readonly SheetRow[];
    marks: CompiledMatcher | null;
    /** The rows work where focus is: drawn in the accent, as the section around them is. */
    focused?: boolean;
}) {
    return (
        <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
            {rows.map(row => (
                <div key={row.id} className="flex min-h-8 min-w-0 items-center gap-3 py-0.5">
                    <span className={cn("min-w-0 flex-1 text-sm", focused ? "text-fg" : "text-fg-muted")}>
                        {markedFragments(row.name, marks)}
                    </span>
                    <span className="flex max-w-[65%] flex-wrap justify-end gap-1">
                        {row.inputs.map((input, index) => (
                            <span
                                key={index}
                                className={cn(
                                    CHIP_CLASS,
                                    focused
                                        ? "border-primary/40 bg-surface-raised text-fg"
                                        : "border-edge bg-fill-subtle text-fg-muted",
                                )}
                            >
                                {markedFragments(input, marks)}
                            </span>
                        ))}
                    </span>
                </div>
            ))}
        </div>
    );
}
