import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../context";
import { useKeybinding } from "../../hooks";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import {
    formatKeybinding,
    KEYBINDINGS_OPEN_REQUEST_SETTINGS_KEY,
} from "@/lib/workspace/services/ui/KeybindingService";
import { KEYBINDING_CATALOG } from "@/lib/workspace/services/ui/keybindingCatalog";
import { isMacPlatform } from "@/lib/app/platform";
import { getInterface } from "@/lib/app/bridge";
import { openKeybindingsTab } from "../../modules/keybindings";

/**
 * The "?" keyboard cheat sheet: a read-only overlay generated straight from the keybinding
 * registry (every described binding, actions' shortcuts included, with user overrides applied),
 * rendered with `formatKeybinding`. Registered here too: the "Customize Keyboard Shortcuts"
 * command that opens the settings tab — the two surfaces belong together.
 *
 * `?` toggles it (never while typing — the binding is not `allowInEditable`); Esc or a backdrop
 * click closes.
 */
export function KeybindingCheatSheet() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const [open, setOpen] = useState(false);
    // Re-read the registry when overrides change while the sheet is open.
    const [revision, setRevision] = useState(0);
    const isMac = isMacPlatform();

    useKeybinding({
        id: "workspace-keybinding-cheatsheet",
        // shift+? (not shift+/): the browser reports the shifted character as the key.
        key: "shift+?",
        description: "Show keyboard shortcuts",
        handler: () => setOpen(previous => !previous),
    });

    // The palette-facing command to open the customization tab.
    useEffect(() => {
        if (!context) {
            return;
        }
        const commandService = context.services.get<CommandService>(Services.Command);
        return commandService.register({
            id: "workspace:open-keybindings",
            titleKey: "workspace.shell.keybindings.openSettings",
            run: workspace => openKeybindingsTab(workspace.getContext()),
        });
    }, [context]);

    // The Settings window's "Customize" button signals through global state (its only channel to
    // this window's editor area); each click writes a fresh timestamp.
    useEffect(() => {
        if (!context) {
            return;
        }
        const token = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (change.key === KEYBINDINGS_OPEN_REQUEST_SETTINGS_KEY && change.value) {
                openKeybindingsTab(context);
            }
        });
        return () => token?.cancel();
    }, [context]);

    useEffect(() => {
        if (!open || !context) {
            return;
        }
        const uiService = context.services.get<UIService>(Services.UI);
        return uiService.keybindings.onOverridesChanged(() => setRevision(value => value + 1));
    }, [open, context]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
            }
        };
        document.addEventListener("keydown", handleKeyDown, true);
        return () => document.removeEventListener("keydown", handleKeyDown, true);
    }, [open]);

    // The full static catalog grouped by category, plus described live registrations without a
    // catalog entry ("Other") — the sheet shows everything, whether or not its editor is open.
    const groups = useMemo(() => {
        if (!open || !context) {
            return [];
        }
        void revision;
        const keybindings = context.services.get<UIService>(Services.UI).keybindings;
        const result: Array<{ category: string; items: Array<{ id: string; name: string; key: string }> }> = [];
        const push = (category: string, item: { id: string; name: string; key: string }) => {
            const group = result.find(candidate => candidate.category === category);
            if (group) {
                group.items.push(item);
            } else {
                result.push({ category, items: [item] });
            }
        };

        const catalogIds = new Set<string>();
        for (const entry of KEYBINDING_CATALOG) {
            catalogIds.add(entry.id);
            push(t(entry.categoryKey), {
                id: entry.id,
                name: t(entry.labelKey),
                key: keybindings.getEffectiveKey({ id: entry.id, key: entry.key }),
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
            push(otherLabel, {
                id: catalogId,
                name: binding.description.trim(),
                key: keybindings.getEffectiveKey(binding),
            });
        }
        return result;
    }, [open, context, revision, t]);

    if (!open) {
        return null;
    }

    return (
        <div className="nl-window-content-layer z-50 flex items-center justify-center p-6">
            <div
                className="absolute inset-0 bg-black/30 animate-fade-in"
                onMouseDown={() => setOpen(false)}
            />
            <div className="relative flex max-h-full w-[min(760px,calc(100vw-48px))] flex-col overflow-hidden rounded-md border border-edge bg-surface-raised shadow-2xl">
                <div className="flex shrink-0 items-center gap-3 border-b border-edge px-4 py-3">
                    <span className="flex-1 text-sm font-medium text-fg">
                        {t("workspace.shell.keybindings.cheatSheetTitle")}
                    </span>
                    <button
                        type="button"
                        onClick={() => {
                            setOpen(false);
                            if (context) {
                                openKeybindingsTab(context);
                            }
                        }}
                        className="rounded-md px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                    >
                        {t("workspace.shell.keybindings.cheatSheetCustomize")}
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                    {groups.map(group => (
                        <div key={group.category}>
                            <div className="pt-3 pb-1 text-xs font-medium text-fg-muted">{group.category}</div>
                            <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
                                {group.items.map(entry => (
                                    <div key={entry.id} className="flex h-8 min-w-0 items-center gap-3">
                                        <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">{entry.name}</span>
                                        <span className="shrink-0 rounded border border-edge bg-fill-subtle px-1.5 py-0.5 text-xs tabular-nums text-fg-muted">
                                            {formatKeybinding(entry.key, isMac)}
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
