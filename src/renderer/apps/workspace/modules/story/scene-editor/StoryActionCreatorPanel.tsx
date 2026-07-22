import { useCallback, useEffect, useMemo, useState } from "react";
import { Star } from "lucide-react";
import type { PanelComponentProps } from "../../types";
import { useTranslation } from "@/lib/i18n";
import { SearchBox } from "@/apps/workspace/modules/assets/components/SearchBox";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import {
    ACTION_COMMAND_CATEGORIES,
    ACTION_COMMANDS,
    getActionCommandCategory,
    localizeActionCommand,
    translateActionCommandCategoryLabel,
    type ActionCommandCategory,
    type PaletteActionCommand,
} from "./storyActionCommands";
import { searchActionCommands } from "./storyCommandSearch";
import { useStoryPluginActionCommands } from "./useStoryPluginActionCommands";
import {
    dispatchStoryActionCreateRequest,
    type StoryActionCreatorPanelPayload,
} from "./storyActionCreatorEvents";

const STARRED_CATEGORY_ID = "starred";
const FAVORITES_SETTING_KEY = "story.actionCreator.starredActionIds";

type SidebarCategory = ActionCommandCategory | {
    id: typeof STARRED_CATEGORY_ID;
    label: string;
    icon: typeof Star;
    iconColor: string;
};

export function StoryActionCreatorPanel({ payload }: PanelComponentProps<StoryActionCreatorPanelPayload>) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const settingsService = useMemo(
        () => context && isInitialized ? context.services.get<GlobalSettingsService>(Services.GlobalSettings) : null,
        [context, isInitialized],
    );
    const [query, setQuery] = useState("");
    const [activeCategoryId, setActiveCategoryId] = useState<SidebarCategory["id"]>("all");
    const [starredIds, setStarredIds] = useState<Set<string>>(() => new Set());
    const pluginCommands = useStoryPluginActionCommands();

    useEffect(() => {
        if (!settingsService) {
            return;
        }
        const stored = settingsService.getSync<string[]>(FAVORITES_SETTING_KEY, []) ?? [];
        setStarredIds(new Set(stored.filter(id => typeof id === "string")));
    }, [settingsService]);

    const persistStarredIds = useCallback((next: Set<string>) => {
        if (!settingsService) {
            return;
        }
        void settingsService.set(FAVORITES_SETTING_KEY, [...next]).catch(error => {
            console.warn("[StoryActionCreatorPanel] failed to save starred actions", error);
        });
    }, [settingsService]);

    const toggleStarred = useCallback((commandId: string) => {
        setStarredIds(previous => {
            const next = new Set(previous);
            next.has(commandId) ? next.delete(commandId) : next.add(commandId);
            persistStarredIds(next);
            return next;
        });
    }, [persistStarredIds]);

    const categories = useMemo<SidebarCategory[]>(() => [
        { id: STARRED_CATEGORY_ID, label: t("story.actionCreator.starred"), icon: Star, iconColor: "#c8b06e" },
        ...ACTION_COMMAND_CATEGORIES.map(category => ({ ...category, label: translateActionCommandCategoryLabel(category, t) })),
    ], [t]);

    const allCommands = useMemo<PaletteActionCommand[]>(() => [
        ...ACTION_COMMANDS,
        ...pluginCommands,
    ].map(command => localizeActionCommand(command, t)), [pluginCommands, t]);

    const filteredCommands = useMemo(() => {
        const inCategory = allCommands.filter(command => {
            if (activeCategoryId === STARRED_CATEGORY_ID && !starredIds.has(command.id)) {
                return false;
            }
            if (activeCategoryId !== STARRED_CATEGORY_ID && activeCategoryId !== "all" && command.category !== activeCategoryId) {
                return false;
            }
            return true;
        });
        // Same fuzzy, token-aware matcher the inline `/` creator uses — so `/bg`, a fuzzy abbreviation,
        // or a translated label find the same commands in the sidebar as they do inline.
        return searchActionCommands(inCategory, query);
    }, [activeCategoryId, allCommands, query, starredIds]);

    const createAction = useCallback((commandId: string) => {
        if (!payload?.tabId) {
            return;
        }
        dispatchStoryActionCreateRequest({ tabId: payload.tabId, commandId });
    }, [payload?.tabId]);

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface">
            <div className="border-b border-edge bg-surface px-3 py-3">
                <SearchBox
                    value={query}
                    onChange={setQuery}
                    placeholder={t("story.actionCreator.searchPlaceholder")}
                    className="w-full"
                />
                <div
                    className="nl-no-scrollbar mt-3 flex gap-1 overflow-x-auto pb-0.5"
                    onWheel={event => {
                        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
                            return;
                        }
                        event.preventDefault();
                        event.currentTarget.scrollLeft += event.deltaY;
                    }}
                >
                    {categories.map(category => {
                        const active = activeCategoryId === category.id;
                        const Icon = category.icon;
                        return (
                            <button
                                key={category.id}
                                type="button"
                                className={[
                                    "flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
                                    active
                                        ? "border-primary/45 bg-primary/15 text-fg"
                                        : "border-edge bg-fill-subtle text-fg-muted hover:bg-fill hover:text-fg",
                                ].join(" ")}
                                onClick={() => setActiveCategoryId(category.id)}
                            >
                                <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: category.iconColor }} />
                                <span>{category.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="nl-no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2">
                {filteredCommands.length === 0 ? (
                    <div className="rounded-md border border-edge bg-fill-subtle px-3 py-3 text-sm text-fg-subtle">
                        {t("story.actionCreator.noActions")}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-1">
                        {filteredCommands.map(command => (
                            <ActionCreatorRow
                                key={command.id}
                                command={command}
                                starred={starredIds.has(command.id)}
                                onToggleStarred={toggleStarred}
                                onCreate={createAction}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function ActionCreatorRow(props: {
    command: PaletteActionCommand;
    starred: boolean;
    onToggleStarred: (commandId: string) => void;
    onCreate: (commandId: string) => void;
}) {
    const { t } = useTranslation();
    const category = getActionCommandCategory(props.command.category);
    const Icon = props.command.icon;
    return (
        <div className="group flex items-center rounded-md transition-colors hover:bg-fill">
            <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                onClick={() => props.onCreate(props.command.id)}
            >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-edge bg-fill-subtle">
                    <Icon className="h-4 w-4" style={{ color: category.iconColor }} />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{props.command.label}</span>
                    <span className="block truncate text-2xs text-fg-subtle">{props.command.detail}</span>
                </span>
            </button>
            <button
                type="button"
                className={[
                    "mr-1 grid h-7 w-7 shrink-0 place-items-center rounded text-fg-subtle transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
                    props.starred ? "opacity-100 text-warning" : "opacity-0 hover:text-warning group-hover:opacity-100",
                ].join(" ")}
                title={props.starred ? t("story.actionCreator.removeStarred") : t("story.actionCreator.addStarred")}
                onClick={() => props.onToggleStarred(props.command.id)}
            >
                <Star className="h-3.5 w-3.5" fill={props.starred ? "currentColor" : "none"} />
            </button>
        </div>
    );
}

