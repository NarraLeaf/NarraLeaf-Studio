import { useMemo, useState } from "react";
import { Import, Plus, SquareFunction } from "lucide-react";
import type { StoryCustomCommand } from "@shared/types/story/customCommands";
import { storyCommandsSpec } from "@shared/documents/specs";
import { foldCustomCommandName } from "@shared/story/customCommands";
import {
    CONTROL_SIZE_CLASS,
    CONTROL_SQUARE_CLASS,
    ConfirmModal,
    ContextMenu,
    EmptyState,
    SearchInput,
    useContextMenu,
    type ContextMenuDef,
} from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { useWorkspace } from "@/apps/workspace/context";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import type { PanelComponentProps } from "../types";
import { useStoryCustomCommands } from "./useStoryCustomCommands";
import { useStoryCommandSharing } from "./useStoryCommandSharing";
import { openStoryCommandTab } from "./storyCommandTab";

const SQUARE_BUTTON_CLASS = cn(
    CONTROL_SQUARE_CLASS.sm,
    "flex shrink-0 items-center justify-center rounded-md border border-edge text-fg-muted hover:border-primary/50 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40",
);

/**
 * The 自定义指令 sidebar page: the project's own story commands, a filter over them, a new one, and
 * the two ways to bring one in from another project.
 *
 * A page of its own on the rail rather than a group inside the story panel, because a command is a
 * project resource like a language or a dictionary term: it is written once and called from every
 * story, so it should be reachable without picking a story first.
 */
export function StoryCommandsPanel({ panelId }: PanelComponentProps) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const { service, commands } = useStoryCustomCommands();
    const sharing = useStoryCommandSharing(service);
    const freeze = useFreezeGuard(storyCommandsSpec.pathFor());
    const importMenu = useContextMenu();
    const rowMenu = useContextMenu();
    const [query, setQuery] = useState("");
    const [menuCommand, setMenuCommand] = useState<StoryCustomCommand | null>(null);
    const [deleting, setDeleting] = useState<StoryCustomCommand | null>(null);

    const visible = useMemo(() => {
        const needle = foldCustomCommandName(query.trim());
        if (!needle) {
            return commands;
        }
        return commands.filter(command => (
            foldCustomCommandName(command.name).includes(needle)
            || (command.description ?? "").toLowerCase().includes(needle)
            || command.params.some(param => foldCustomCommandName(param.name).includes(needle))
        ));
    }, [commands, query]);

    const openCommand = (command: StoryCustomCommand) => {
        if (context) {
            openStoryCommandTab(context, command.id, command.name);
        }
    };
    const createCommand = () => {
        if (!service) {
            return;
        }
        // A name typed into the filter that matches nothing is the name the author is looking for.
        const typed = query.trim();
        const base = typed && !service.nameProblem(typed) ? typed : t("story.customCommands.newName");
        let name = base;
        for (let suffix = 2; service.nameProblem(name); suffix += 1) {
            name = `${base}${suffix}`;
        }
        const command = service.createCommand(name);
        if (command) {
            setQuery("");
            openCommand(command);
        }
    };

    const importItems: ContextMenuDef = [
        { id: "file", label: t("story.customCommands.importFile"), onClick: () => void sharing.importFromFile(), ...freeze.menuRow() },
        { id: "clipboard", label: t("story.customCommands.importClipboard"), onClick: () => void sharing.importFromClipboard(), ...freeze.menuRow() },
    ];
    const rowItems: ContextMenuDef = menuCommand ? [
        { id: "open", label: t("story.customCommands.open"), onClick: () => openCommand(menuCommand) },
        { id: "copy", label: t("story.customCommands.copyAsText"), onClick: () => void sharing.copyAsText([menuCommand]) },
        { id: "export", label: t("story.customCommands.export"), onClick: () => void sharing.exportToFile([menuCommand]) },
        { id: "separator", separator: true as const },
        { id: "delete", label: t("story.customCommands.delete"), onClick: () => setDeleting(menuCommand), ...freeze.menuRow() },
    ] : [];

    return (
        <div className="flex h-full flex-col" data-panel-id={panelId}>
            <div className="flex items-center gap-1.5 px-2 py-2">
                <SearchInput
                    size="sm"
                    fullWidth
                    value={query}
                    placeholder={t("story.customCommands.search")}
                    onChange={event => setQuery(event.target.value)}
                    onKeyDown={event => {
                        event.stopPropagation();
                        if (event.key === "Enter" && visible.length === 0) {
                            createCommand();
                        }
                    }}
                />
                <button
                    type="button"
                    className={SQUARE_BUTTON_CLASS}
                    aria-label={t("story.customCommands.import")}
                    onClick={importMenu.showMenu}
                    {...freeze.writes(!service, t("story.customCommands.import"))}
                >
                    <Import className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    className={SQUARE_BUTTON_CLASS}
                    aria-label={t("story.customCommands.new")}
                    onClick={createCommand}
                    {...freeze.writes(!service, t("story.customCommands.new"))}
                >
                    <Plus className="h-3.5 w-3.5" />
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {visible.length === 0 ? (
                    <EmptyState
                        size="sm"
                        className="h-full"
                        icon={<SquareFunction className="h-5 w-5" />}
                        title={commands.length === 0 ? t("story.customCommands.empty") : t("story.customCommands.noMatches")}
                        description={commands.length === 0 ? t("story.customCommands.emptyHint") : undefined}
                    />
                ) : (
                    visible.map(command => (
                        <button
                            key={command.id}
                            type="button"
                            data-story-command-id={command.id}
                            className={cn(
                                CONTROL_SIZE_CLASS.sm,
                                "flex w-full min-w-0 cursor-default items-center gap-2 px-2 text-left text-fg-muted transition-colors hover:bg-fill hover:text-fg",
                                menuCommand?.id === command.id && rowMenu.menuState.visible && "bg-fill text-fg",
                            )}
                            onClick={() => openCommand(command)}
                            onContextMenu={event => {
                                setMenuCommand(command);
                                rowMenu.showMenu(event);
                            }}
                        >
                            <SquareFunction className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                            <span className="min-w-0 truncate">{command.name}</span>
                            {command.params.length > 0 && (
                                <span className="ml-auto min-w-0 shrink truncate text-2xs text-fg-subtle">
                                    {command.params.map(param => param.name).join(" · ")}
                                </span>
                            )}
                        </button>
                    ))
                )}
            </div>

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
        </div>
    );
}
