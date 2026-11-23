import { useState } from "react";
import { Import, Plus, SquareFunction } from "lucide-react";
import type { StoryCustomCommand } from "@shared/types/story/customCommands";
import { ConfirmModal, ContextMenu, useContextMenu, type ContextMenuDef } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "@/apps/workspace/context";
import { useStoryCustomCommands } from "./useStoryCustomCommands";
import { useStoryCommandSharing } from "./useStoryCommandSharing";
import { openStoryCommandTab } from "./storyCommandTab";

/**
 * The 自定义指令 group of the story panel: the project's own commands, a new one, and the two ways to
 * bring one in from elsewhere. Returns the group's header actions and its body separately, because
 * the panel's accordion owns the header row.
 */
export function useStoryCommandsSection(): { count: number; actions: React.ReactNode; body: React.ReactNode } {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const { service, commands } = useStoryCustomCommands();
    const sharing = useStoryCommandSharing(service);
    const importMenu = useContextMenu();
    const rowMenu = useContextMenu();
    const [menuCommand, setMenuCommand] = useState<StoryCustomCommand | null>(null);
    const [deleting, setDeleting] = useState<StoryCustomCommand | null>(null);

    const openCommand = (command: StoryCustomCommand) => {
        if (context) {
            openStoryCommandTab(context, command.id, command.name);
        }
    };
    const createCommand = () => {
        if (!service) {
            return;
        }
        const base = t("story.customCommands.newName");
        let name = base;
        for (let suffix = 2; service.nameProblem(name); suffix += 1) {
            name = `${base}${suffix}`;
        }
        const command = service.createCommand(name);
        if (command) {
            openCommand(command);
        }
    };

    const importItems: ContextMenuDef = [
        { id: "file", label: t("story.customCommands.importFile"), onClick: () => void sharing.importFromFile() },
        { id: "clipboard", label: t("story.customCommands.importClipboard"), onClick: () => void sharing.importFromClipboard() },
    ];
    const rowItems: ContextMenuDef = menuCommand ? [
        { id: "open", label: t("story.customCommands.open"), onClick: () => openCommand(menuCommand) },
        { id: "copy", label: t("story.customCommands.copyAsText"), onClick: () => void sharing.copyAsText([menuCommand]) },
        { id: "export", label: t("story.customCommands.export"), onClick: () => void sharing.exportToFile([menuCommand]) },
        { id: "separator", separator: true as const },
        { id: "delete", label: t("story.customCommands.delete"), onClick: () => setDeleting(menuCommand) },
    ] : [];

    const actions = (
        <>
            <button
                type="button"
                className="p-1 hover:text-primary"
                data-tip={t("story.customCommands.import")}
                aria-label={t("story.customCommands.import")}
                onClick={importMenu.showMenu}
            >
                <Import className="h-3 w-3" />
            </button>
            <button
                type="button"
                className="p-1 hover:text-primary"
                data-tip={t("story.customCommands.new")}
                aria-label={t("story.customCommands.new")}
                onClick={createCommand}
            >
                <Plus className="h-3 w-3" />
            </button>
        </>
    );

    const body = (
        <>
            {commands.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-fg-subtle">{t("story.customCommands.empty")}</div>
            ) : (
                <div className="py-1">
                    {commands.map(command => (
                        <button
                            key={command.id}
                            type="button"
                            className="flex w-full min-w-0 items-center gap-2 px-3 py-1 text-left hover:bg-fill"
                            onClick={() => openCommand(command)}
                            onContextMenu={event => {
                                setMenuCommand(command);
                                rowMenu.showMenu(event);
                            }}
                        >
                            <SquareFunction className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                            <span className="min-w-0 flex-1 truncate text-sm text-fg">{command.name}</span>
                            {command.params.length > 0 && (
                                <span className="min-w-0 truncate text-2xs text-fg-subtle">{command.params.map(param => param.name).join(" ")}</span>
                            )}
                        </button>
                    ))}
                </div>
            )}
            <ContextMenu items={importItems} position={importMenu.menuState.position} visible={importMenu.menuState.visible} onClose={importMenu.hideMenu} />
            <ContextMenu items={rowItems} position={rowMenu.menuState.position} visible={rowMenu.menuState.visible} onClose={rowMenu.hideMenu} />
            <ConfirmModal
                isOpen={deleting !== null}
                onClose={() => setDeleting(null)}
                onConfirm={() => {
                    if (deleting) {
                        service?.removeCommand(deleting.id);
                    }
                    setDeleting(null);
                }}
                title={t("story.customCommands.deleteTitle")}
                message={t("story.customCommands.deleteMessage", { name: deleting?.name ?? "" })}
                confirmText={t("story.customCommands.delete")}
            />
        </>
    );

    return { count: commands.length, actions, body };
}
