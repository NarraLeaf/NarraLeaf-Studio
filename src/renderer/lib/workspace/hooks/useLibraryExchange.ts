import { useCallback, useMemo } from "react";
import type { LibraryExchangeKind, LibraryExchangeResult } from "@shared/story/libraryExchange";
import { NotificationType } from "@/lib/workspace/services/ui/types";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { useWorkspace } from "@/apps/workspace/context";

/**
 * Writing a library out to a file, and reading one back in.
 *
 * The file dialogs live in the main process (a path from a picker carries no renderer write grant),
 * so both halves are one IPC call plus what to say when it does not work out. Shared by the two
 * surfaces that have a library to exchange - the transform card's preset manager and the Story
 * Motion panel - because the sentences are the same for both and neither is the right place to keep
 * them.
 *
 * **Export says nothing on success**: the author picked the file, and the dialog closing is what
 * tells them it was written. **Import always does**: nothing on screen would otherwise say how many
 * entries arrived, or that a file the author picked held none this build could read.
 */
export function useLibraryExchange(kind: LibraryExchangeKind): {
    /** Write `content` to a file the author picks. `false` means they cancelled or it failed. */
    exportItems(content: string, defaultFileName: string): Promise<boolean>;
    /**
     * Read a file the author picks and decode it with the caller's reader.
     *
     * `null` means there is nothing to import - cancelled, unreadable, or a file for the other
     * library - and the author has already been told which.
     */
    importItems<T>(decode: (text: string) => LibraryExchangeResult<T>): Promise<T[] | null>;
    /** Say how many entries landed. Called by the surface, which is what actually writes them. */
    announceImported(count: number): void;
} {
    const { t, tn } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const notifications = useMemo(
        () => (context && isInitialized ? context.services.get<UIService>(Services.UI).notifications : null),
        [context, isInitialized],
    );

    const warn = useCallback((message: string) => {
        notifications?.show({ type: NotificationType.Warning, message });
    }, [notifications]);

    const exportItems = useCallback(async (content: string, defaultFileName: string): Promise<boolean> => {
        const result = await getInterface().app.exportLibraryItems(kind, defaultFileName, content);
        if (!result.success) {
            warn(t("common.library.exportFailed"));
            return false;
        }
        return !result.data.canceled;
    }, [kind, t, warn]);

    const importItems = useCallback(async <T,>(decode: (text: string) => LibraryExchangeResult<T>): Promise<T[] | null> => {
        const result = await getInterface().app.importLibraryItems(kind);
        if (!result.success) {
            warn(t("common.library.importFailed"));
            return null;
        }
        if (result.data.canceled || typeof result.data.content !== "string") {
            return null;
        }
        const decoded = decode(result.data.content);
        if (!decoded.ok) {
            warn(t(`common.library.${decoded.reason}` as "common.library.unreadable"));
            return null;
        }
        return decoded.items;
    }, [kind, t, warn]);

    const announceImported = useCallback((count: number) => {
        notifications?.show({ type: NotificationType.Info, message: tn("common.library.imported", count) });
    }, [notifications, tn]);

    return { exportItems, importItems, announceImported };
}
