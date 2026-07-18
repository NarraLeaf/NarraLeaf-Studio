import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import { getInterface } from "@/lib/app/bridge";

/** Global setting: ids of status bar entries the user has switched off. */
export const STATUS_BAR_HIDDEN_ITEMS_KEY = "ui.statusBar.hiddenItems";

function readHiddenIds(value: unknown): string[] {
    // Persisted values are untrusted — a hand-edited global.json should degrade to "nothing hidden"
    // rather than throw inside the layout.
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

interface StatusBarEntryVisibility {
    hiddenIds: ReadonlySet<string>;
    /** Hide or show a single entry, persisting the whole set. */
    setEntryHidden: (id: string, hidden: boolean) => void;
}

/**
 * Which status bar entries the user has switched off, stored globally (a preference about the
 * Studio chrome, not about any one project) under a single key — the same shape as
 * `keybindings.overrides`, and for the same reason: entry ids contain dots and `:` separators that
 * the dotted-path settings store would otherwise split into nested objects.
 *
 * Hidden-by-id rather than shown-by-id so that entries added in a future release start visible
 * without needing a migration.
 */
export function useStatusBarEntryVisibility(): StatusBarEntryVisibility {
    const { context } = useWorkspace();
    const [hidden, setHidden] = useState<string[]>([]);

    useEffect(() => {
        if (!context) {
            return;
        }
        const settings = context.services.get<GlobalSettingsService>(Services.GlobalSettings);
        setHidden(readHiddenIds(settings.getSync(STATUS_BAR_HIDDEN_ITEMS_KEY)));
        // The settings window writes to the same store, so follow live changes rather than reading once.
        const token = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (change.key === STATUS_BAR_HIDDEN_ITEMS_KEY) {
                setHidden(readHiddenIds(change.value));
            }
        });
        return () => token?.cancel();
    }, [context]);

    const hiddenIds = useMemo(() => new Set(hidden), [hidden]);

    const setEntryHidden = useCallback(
        (id: string, hide: boolean) => {
            const next = hide ? [...new Set([...hidden, id])] : hidden.filter(entryId => entryId !== id);
            setHidden(next);
            void getInterface().app.state.setGlobalState(STATUS_BAR_HIDDEN_ITEMS_KEY, next);
        },
        [hidden],
    );

    return { hiddenIds, setEntryHidden };
}
