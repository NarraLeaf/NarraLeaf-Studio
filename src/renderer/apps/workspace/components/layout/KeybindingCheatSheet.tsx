import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Keyboard } from "lucide-react";
import { useWorkspace } from "../../context";
import { useKeybinding } from "../../hooks";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import {
    formatKeybinding,
    KEYBINDING_OVERRIDES_SETTINGS_KEY,
} from "@/lib/workspace/services/ui/KeybindingService";
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
} from "@/lib/workspace/services/ui/fixedInputCatalog";
import { isMacPlatform } from "@/lib/app/platform";
import { getInterface } from "@/lib/app/bridge";
import { useFloatingLayer } from "@/lib/components/layout";

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

/**
 * Groups that are never "the editor in front of you": they apply everywhere, so a sheet opened on
 * them would land where it already starts.
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

const OTHER_CATEGORY = "other";

interface SheetRow {
    id: string;
    name: string;
    /** Every way to run the row's command: its chord first, then any gestures that do the same. */
    inputs: string[];
}

interface SheetGroup {
    key: string;
    title: string;
    rows: SheetRow[];
}

/**
 * The "?" cheat sheet: a read-only overlay generated straight from the keybinding registry (every
 * described binding, actions' shortcuts included, with user overrides applied) and from the
 * fixed-input catalog, which holds the mouse gestures and the keys that cannot be rebound. Both are
 * filed under the same per-editor groups, so an editor's keys and its gestures read as one section.
 * Registered here too: the "Customize Keyboard Shortcuts" command that opens the settings tab — the
 * two surfaces belong together.
 *
 * It opens scrolled to the group of the editor that has focus, so the answer to "what can I do here"
 * is the first thing on screen; the order of the groups never changes, so the rest stays where it
 * was last time.
 *
 * `?` toggles it (never while typing — the binding is not `allowInEditable`); Esc or a backdrop
 * click closes.
 */
export function KeybindingCheatSheet() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const [open, setOpen] = useState(false);
    // The group the sheet scrolls to when it opens; read from focus at the moment it opens.
    const [landingCategory, setLandingCategory] = useState<string | null>(null);
    // Re-read the registry when overrides change while the sheet is open.
    const [revision, setRevision] = useState(0);
    const isMac = isMacPlatform();
    const scrollRef = useRef<HTMLDivElement>(null);

    /**
     * The group of the editor that has focus: whichever editor group owns the most bindings whose
     * `when` admits the current focus. Read before the sheet opens, while focus still describes the
     * workspace rather than the sheet.
     */
    const focusedCategory = useCallback((): string | null => {
        if (!context) {
            return null;
        }
        const keybindings = context.services.get<UIService>(Services.UI).keybindings;
        const counts = new Map<string, number>();
        for (const id of keybindings.getFocusedCatalogIds()) {
            const category = getKeybindingCatalogEntry(id)?.categoryKey;
            if (category && !WORKSPACE_WIDE_CATEGORIES.has(category)) {
                counts.set(category, (counts.get(category) ?? 0) + 1);
            }
        }
        let best: string | null = null;
        for (const [category, count] of counts) {
            if (best === null || count > (counts.get(best) ?? 0)) {
                best = category;
            }
        }
        return best;
    }, [context]);

    const openSheet = useCallback(() => {
        setLandingCategory(focusedCategory());
        setOpen(true);
    }, [focusedCategory]);

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

    // The full static catalog grouped by category, then the fixed inputs filed under the same
    // groups, plus described live registrations without a catalog entry ("Other") — the sheet shows
    // everything, whether or not its editor is open.
    const groups = useMemo((): SheetGroup[] => {
        if (!open || !context) {
            return [];
        }
        void revision;
        const keybindings = context.services.get<UIService>(Services.UI).keybindings;
        const result: SheetGroup[] = [];
        const push = (key: string, title: string, row: SheetRow) => {
            const group = result.find(candidate => candidate.key === key);
            if (group) {
                group.rows.push(row);
            } else {
                result.push({ key, title, rows: [row] });
            }
        };
        const formatInput = (input: Parameters<typeof formatFixedInput>[0]) => formatFixedInput(input, isMac, t);

        const catalogIds = new Set<string>();
        for (const entry of KEYBINDING_CATALOG) {
            catalogIds.add(entry.id);
            push(entry.categoryKey, t(entry.categoryKey), {
                id: entry.id,
                name: t(entry.labelKey),
                inputs: [
                    formatKeybinding(keybindings.getEffectiveKey({ id: entry.id, key: entry.key }), isMac),
                    ...getFixedInputsExtending(entry.id).map(formatInput),
                ],
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
                inputs: item.inputs.map(formatInput),
            });
        }

        const otherLabel = t("workspace.shell.keybindings.categories.other");
        const seen = new Set<string>();
        for (const binding of keybindings.getAll()) {
            const catalogId = binding.catalogId ?? binding.id;
            if (catalogIds.has(catalogId) || seen.has(catalogId) || !binding.description?.trim()) {
                continue;
            }
            seen.add(catalogId);
            push(OTHER_CATEGORY, otherLabel, {
                id: catalogId,
                name: binding.description.trim(),
                inputs: [formatKeybinding(keybindings.getEffectiveKey(binding), isMac)],
            });
        }
        return result;
    }, [open, context, revision, t, isMac]);

    // Land on the focused editor's group: its heading goes to the top of the scroll area. Layout
    // effect, so the first frame the author sees is already the scrolled one.
    useLayoutEffect(() => {
        if (!open) {
            return;
        }
        const scroller = scrollRef.current;
        if (!scroller) {
            return;
        }
        const heading = landingCategory
            ? scroller.querySelector<HTMLElement>(`[data-cheat-sheet-group="${CSS.escape(landingCategory)}"]`)
            : null;
        // The scroller is the headings' offset parent (`relative`), so `offsetTop` is already measured
        // from its top edge.
        scroller.scrollTop = heading ? heading.offsetTop : 0;
    }, [open, landingCategory, groups]);

    if (!open) {
        return null;
    }

    return (
        <div className="nl-window-content-layer z-50 flex items-center justify-center p-6">
            <div
                className="absolute inset-0 bg-black/30 animate-fade-in"
                onMouseDown={() => setOpen(false)}
            />
            <div
                ref={panelRef}
                role="dialog"
                aria-label={t("workspace.shell.keybindings.cheatSheetTitle")}
                className="relative flex max-h-full w-[min(760px,calc(100vw-48px))] flex-col overflow-hidden rounded-md border border-edge bg-surface-raised shadow-2xl"
            >
                <div className="flex shrink-0 items-center gap-3 border-b border-edge px-4 py-3">
                    <span className="flex-1 text-sm font-medium text-fg">
                        {t("workspace.shell.keybindings.cheatSheetTitle")}
                    </span>
                    <button
                        type="button"
                        onClick={() => {
                            setOpen(false);
                            openKeybindingSettings();
                        }}
                        className="rounded-md px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                    >
                        {t("workspace.shell.keybindings.cheatSheetCustomize")}
                    </button>
                </div>
                <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto px-4 py-3">
                    {groups.map(group => (
                        <div key={group.key} data-cheat-sheet-group={group.key}>
                            <div className="pt-3 pb-1 text-xs font-medium text-fg-muted">{group.title}</div>
                            <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
                                {group.rows.map(row => (
                                    <div key={row.id} className="flex min-h-8 min-w-0 items-center gap-3 py-0.5">
                                        <span className="min-w-0 flex-1 text-sm text-fg-muted">{row.name}</span>
                                        <span className="flex max-w-[65%] flex-wrap justify-end gap-1">
                                            {row.inputs.map((input, index) => (
                                                <span
                                                    key={index}
                                                    className="whitespace-nowrap rounded-md border border-edge bg-fill-subtle px-1.5 py-0.5 text-xs tabular-nums text-fg-muted"
                                                >
                                                    {input}
                                                </span>
                                            ))}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
