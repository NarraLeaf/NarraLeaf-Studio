import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../../context";
import { useKeybinding } from "../../hooks";
import { useRegistry } from "../../registry";
import { Services } from "@/lib/workspace/services/services";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { formatKeybinding } from "@/lib/workspace/services/ui/KeybindingService";
import { isMacPlatform } from "@/lib/app/platform";
import { useTranslation } from "@/lib/i18n";
import { QuickSwitchOverlay, type QuickListRow } from "./QuickSwitchOverlay";
import { clampIndex, rankFuzzyList, wrapIndex } from "./fuzzyListModel";
import type { PaletteCommand } from "./commandPaletteModel";

/**
 * Render a command title with the fuzzy-matched characters emphasized. `positions` are indices
 * into `title` (from `rankFuzzyList`); an empty array (e.g. a category-only match) renders plainly.
 */
function highlightTitle(title: string, positions: number[]) {
    if (positions.length === 0) {
        return title;
    }
    const marked = new Set(positions);
    return (
        <>
            {Array.from(title).map((char, index) =>
                marked.has(index) ? (
                    <span key={index} className="font-semibold text-fg">
                        {char}
                    </span>
                ) : (
                    char
                ),
            )}
        </>
    );
}

/**
 * The command palette: a searchable, keyboard-driven list of everything the user can do right now,
 * opened with Cmd/Ctrl+Shift+P. It gathers its entries from {@link CommandService} (which converges
 * toolbar actions, menu groups, and described keybindings) and filters them with the shared fuzzy
 * list, reusing the same floating overlay as the editor quick switch.
 *
 * Lives in the workspace shell beside the quick switch so its shortcut survives even when no editor
 * is focused. The commands are snapshotted when the palette opens — it is a transient surface, and
 * a snapshot keeps the list stable while the user types.
 */
export function CommandPalette() {
    const { t } = useTranslation();
    const { workspace, context } = useWorkspace();
    // Subscribed so the snapshot refreshes if actions change while the palette is open.
    const { actions, actionGroups } = useRegistry();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [commands, setCommands] = useState<PaletteCommand[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);
    const isMac = isMacPlatform();

    const commandService = context ? context.services.get<CommandService>(Services.Command) : null;

    // No `description`: the toggle must not list itself as a command inside its own palette.
    useKeybinding({
        id: "workspace-command-palette",
        key: "mod+shift+p",
        handler: () => setOpen(previous => !previous),
        allowInEditable: true,
    });

    // Snapshot the available commands when the palette opens (and if the registry changes while open).
    useEffect(() => {
        if (!open || !workspace || !commandService) {
            return;
        }
        setCommands(commandService.collect(workspace));
    }, [open, workspace, commandService, actions, actionGroups]);

    // Reset the query and selection each time it opens.
    useEffect(() => {
        if (open) {
            setQuery("");
            setSelectedIndex(0);
        }
    }, [open]);

    // Focus the search box once the overlay has painted.
    useEffect(() => {
        if (!open) {
            return;
        }
        const frame = requestAnimationFrame(() => inputRef.current?.focus());
        return () => cancelAnimationFrame(frame);
    }, [open]);

    // Dismiss when the window loses focus, mirroring the editor quick switch.
    useEffect(() => {
        if (!open) {
            return;
        }
        const handleBlur = () => setOpen(false);
        window.addEventListener("blur", handleBlur);
        return () => window.removeEventListener("blur", handleBlur);
    }, [open]);

    const ranked = useMemo(
        () => rankFuzzyList(commands, query, command => [command.title, command.category ?? ""]),
        [commands, query],
    );

    // Keep the selection inside the (re-filtered) list.
    useEffect(() => {
        setSelectedIndex(index => clampIndex(index, ranked.length));
    }, [ranked.length]);

    const close = useCallback(() => setOpen(false), []);

    const commit = useCallback(
        (index: number) => {
            const entry = ranked[index]?.item;
            setOpen(false);
            if (!entry) {
                return;
            }
            try {
                const result = entry.run();
                if (result instanceof Promise) {
                    result.catch(error => reportCommandError(context, error));
                }
            } catch (error) {
                reportCommandError(context, error);
            }
        },
        [ranked, context],
    );

    const handleInputKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLInputElement>) => {
            const handled = () => {
                event.preventDefault();
                // Keep navigation keys from also reaching the global keybinding service.
                event.stopPropagation();
            };
            switch (event.key) {
                case "ArrowDown":
                    handled();
                    setSelectedIndex(index => wrapIndex(index + 1, ranked.length));
                    break;
                case "ArrowUp":
                    handled();
                    setSelectedIndex(index => wrapIndex(index - 1, ranked.length));
                    break;
                case "Home":
                    handled();
                    setSelectedIndex(0);
                    break;
                case "End":
                    handled();
                    setSelectedIndex(Math.max(0, ranked.length - 1));
                    break;
                case "Enter":
                    handled();
                    commit(selectedIndex);
                    break;
                case "Escape":
                    handled();
                    close();
                    break;
                default:
                    break;
            }
        },
        [ranked.length, selectedIndex, commit, close],
    );

    if (!open) {
        return null;
    }

    const rows: QuickListRow[] = ranked.map(({ item, positions }) => ({
        key: item.id,
        icon: item.icon,
        title: (
            <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate">{highlightTitle(item.title, positions)}</span>
                {item.category && (
                    <span className="shrink-0 text-xs text-fg-subtle">{item.category}</span>
                )}
            </span>
        ),
        trailing: item.keybinding ? (
            <span className="tabular-nums">{formatKeybinding(item.keybinding, isMac)}</span>
        ) : undefined,
    }));

    return (
        <>
            {/* Click-away layer: sits below the overlay; the overlay's empty region is click-through.
                Dimmed slightly — enough to pull focus onto the palette without reading as a modal
                (dialogs use bg-black/60; this is deliberately much lighter). */}
            <div className="nl-window-content-layer z-[45] bg-black/15 animate-fade-in" onMouseDown={close} />
            <QuickSwitchOverlay
                zClassName="z-[46]"
                rows={rows}
                selectedIndex={selectedIndex}
                onCommit={commit}
                onHoverIndex={setSelectedIndex}
                ariaLabel={t("workspace.shell.commandPalette.title")}
                emptyText={t("workspace.shell.commandPalette.empty")}
                search={{
                    value: query,
                    placeholder: t("workspace.shell.commandPalette.placeholder"),
                    ariaLabel: t("workspace.shell.commandPalette.title"),
                    onChange: setQuery,
                    onKeyDown: handleInputKeyDown,
                    inputRef,
                }}
            />
        </>
    );
}

function reportCommandError(
    context: ReturnType<typeof useWorkspace>["context"],
    error: unknown,
): void {
    if (context) {
        context.services.get<UIService>(Services.UI).showError(error instanceof Error ? error : String(error));
        return;
    }
    console.error("[CommandPalette] command failed:", error);
}
