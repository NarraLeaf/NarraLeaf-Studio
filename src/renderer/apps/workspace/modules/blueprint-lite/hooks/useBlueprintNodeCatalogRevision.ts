import { useCallback, useSyncExternalStore } from "react";
import type { IBlueprintNodeCatalogService } from "@/lib/workspace/services/services";

/**
 * The node catalogue's revision, re-rendering the caller whenever node types are registered.
 *
 * What lets a blueprint drawn before a plugin loaded - a tab the workspace restored, or one open
 * while the author enables the plugin - draw that plugin's nodes once they are known, instead of
 * keeping them as unknown nodes until the tab is closed and opened again.
 */
export function useBlueprintNodeCatalogRevision(nodeCatalog: IBlueprintNodeCatalogService): number {
    const subscribe = useCallback((listener: () => void) => nodeCatalog.onCatalogChanged(listener), [nodeCatalog]);
    const read = useCallback(() => nodeCatalog.getCatalogRevision(), [nodeCatalog]);
    return useSyncExternalStore(subscribe, read, read);
}
