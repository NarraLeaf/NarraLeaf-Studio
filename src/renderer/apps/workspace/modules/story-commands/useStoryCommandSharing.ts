import { useCallback, useMemo } from "react";
import type { StoryCustomCommand } from "@shared/types/story/customCommands";
import {
    decodeStoryCommandExchange,
    encodeStoryCommandExchange,
    libraryExchangeFileName,
} from "@shared/story/libraryExchange";
import { useTranslation } from "@/lib/i18n";
import { useLibraryExchange } from "@/lib/workspace/hooks/useLibraryExchange";
import { NotificationType } from "@/lib/workspace/services/ui/types";
import { Services } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { StoryCustomCommandService } from "@/lib/workspace/services/story/StoryCustomCommandService";
import { useWorkspace } from "@/apps/workspace/context";

/**
 * Sharing story commands with another project, with nothing in between: a file, or the same text on
 * the clipboard to paste into a chat. Both carry the commands a chosen one calls.
 */
export function useStoryCommandSharing(service: StoryCustomCommandService | null): {
    exportToFile(commands: readonly StoryCustomCommand[]): Promise<void>;
    copyAsText(commands: readonly StoryCustomCommand[]): Promise<void>;
    importFromFile(): Promise<void>;
    importFromClipboard(): Promise<void>;
} {
    const { t } = useTranslation();
    const exchange = useLibraryExchange("story-command");
    const { context, isInitialized } = useWorkspace();
    const notifications = useMemo(
        () => (context && isInitialized ? context.services.get<UIService>(Services.UI).notifications : null),
        [context, isInitialized],
    );

    const encode = useCallback((commands: readonly StoryCustomCommand[]) => (
        encodeStoryCommandExchange(commands, service?.listCommands() ?? commands)
    ), [service]);

    const land = useCallback((items: StoryCustomCommand[]) => {
        const added = service?.importCommands(items) ?? [];
        exchange.announceImported(added.length);
    }, [exchange, service]);

    const exportToFile = useCallback(async (commands: readonly StoryCustomCommand[]) => {
        if (commands.length === 0) {
            return;
        }
        await exchange.exportItems(encode(commands), libraryExchangeFileName("story-command", commands.map(command => command.name)));
    }, [encode, exchange]);

    const copyAsText = useCallback(async (commands: readonly StoryCustomCommand[]) => {
        if (commands.length === 0) {
            return;
        }
        try {
            await navigator.clipboard.writeText(encode(commands));
            notifications?.show({ type: NotificationType.Info, message: t("story.customCommands.copied") });
        } catch {
            notifications?.show({ type: NotificationType.Warning, message: t("story.customCommands.copyFailed") });
        }
    }, [encode, notifications, t]);

    const importFromFile = useCallback(async () => {
        const items = await exchange.importItems(decodeStoryCommandExchange);
        if (items) {
            land(items);
        }
    }, [exchange, land]);

    const importFromClipboard = useCallback(async () => {
        let text = "";
        try {
            text = await navigator.clipboard.readText();
        } catch {
            notifications?.show({ type: NotificationType.Warning, message: t("story.customCommands.pasteFailed") });
            return;
        }
        const decoded = decodeStoryCommandExchange(text);
        if (!decoded.ok) {
            notifications?.show({ type: NotificationType.Warning, message: t(`common.library.${decoded.reason}` as "common.library.unreadable") });
            return;
        }
        land(decoded.items);
    }, [land, notifications, t]);

    return { exportToFile, copyAsText, importFromFile, importFromClipboard };
}
