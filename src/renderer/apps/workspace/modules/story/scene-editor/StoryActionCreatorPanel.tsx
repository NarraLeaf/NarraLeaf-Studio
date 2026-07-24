import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutGrid, Star } from "lucide-react";
import type { PanelComponentProps } from "../../types";
import { useTranslation } from "@/lib/i18n";
import { SearchBox } from "@/apps/workspace/modules/assets/components/SearchBox";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import type { PaletteActionCommand } from "./storyActionCommands";
import {
    commandCategoryLabelKey,
    getCommandGroup,
    STORY_COMMAND_CATEGORIES,
    type StoryCommandCategoryId,
} from "./storyCommandCategories";
import { localizeSpecCommand } from "./commands/specPalette";
import { buildSpecSidebarGroups, filterSidebarGroups, type StoryCommandSidebarGroup } from "./commands/specSidebar";
import { searchActionCommands } from "./storyCommandSearch";
import { useStoryPluginActionCommands } from "./useStoryPluginActionCommands";
import { FAVORITES_SETTING_KEY, migrateStarredActionIds } from "./storyActionCreatorFavorites";
import {
    dispatchStoryActionCreateRequest,
    type StoryActionCreatorPanelPayload,
} from "./storyActionCreatorEvents";

/**
 * The Action Creator sidebar: the spec registry, browsed by subject.
 *
 * It used to render `ACTION_COMMANDS`, a catalogue of its own with its own ids, its own labels and an
 * "object type × verb" shape the inline `/` creator contradicted. A1 deleted that catalogue - the rows
 * here are the same spec palette entries the `/` menu shows, re-filed under every subject each command
 * accepts, so the two menus can no longer disagree about what exists or what it is called.
 */

const STARRED_CATEGORY_ID = "starred";
const ALL_CATEGORY_ID = "all";

type SidebarTab = typeof STARRED_CATEGORY_ID | typeof ALL_CATEGORY_ID | StoryCommandCategoryId;

export function StoryActionCreatorPanel({ payload }: PanelComponentProps<StoryActionCreatorPanelPayload>) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const settingsService = useMemo(
        () => context && isInitialized ? context.services.get<GlobalSettingsService>(Services.GlobalSettings) : null,
        [context, isInitialized],
    );
    const [query, setQuery] = useState("");
    const [activeTab, setActiveTab] = useState<SidebarTab>(ALL_CATEGORY_ID);
    const [starredIds, setStarredIds] = useState<Set<string>>(() => new Set());
    const pluginCommands = useStoryPluginActionCommands();

    const persistStarredIds = useCallback((next: readonly string[]) => {
        if (!settingsService) {
            return;
        }
        void settingsService.set(FAVORITES_SETTING_KEY, [...next]).catch(error => {
            console.warn("[StoryActionCreatorPanel] failed to save starred actions", error);
        });
    }, [settingsService]);

    useEffect(() => {
        if (!settingsService) {
            return;
        }
        const stored = settingsService.getSync<string[]>(FAVORITES_SETTING_KEY, []) ?? [];
        // Favourites persist palette ids, and A1 changed which catalogue those come from. Rewriting
        // them here - and writing the result straight back - is what keeps a starred "Image show"
        // showing up as a starred `/show` instead of quietly disappearing.
        const migrated = migrateStarredActionIds(stored.filter(id => typeof id === "string"));
        setStarredIds(new Set(migrated));
        if (migrated.length !== stored.length || migrated.some((id, index) => id !== stored[index])) {
            persistStarredIds(migrated);
        }
    }, [persistStarredIds, settingsService]);

    const toggleStarred = useCallback((commandId: string) => {
        setStarredIds(previous => {
            const next = new Set(previous);
            next.has(commandId) ? next.delete(commandId) : next.add(commandId);
            persistStarredIds([...next]);
            return next;
        });
    }, [persistStarredIds]);

    const localize = useCallback((command: PaletteActionCommand) => localizeSpecCommand(command, t), [t]);

    const sidebarGroups = useMemo(
        () => buildSpecSidebarGroups(pluginCommands, localize),
        [localize, pluginCommands],
    );

    /**
     * The starred tab is a flat set - a command filed under three subjects is still ONE favourite, so
     * it must not appear three times here.
     */
    const starredCommands = useMemo<PaletteActionCommand[]>(() => {
        if (activeTab !== STARRED_CATEGORY_ID) {
            return [];
        }
        const seen = new Set<string>();
        const starred: PaletteActionCommand[] = [];
        for (const group of sidebarGroups) {
            for (const command of group.commands) {
                if (starredIds.has(command.id) && !seen.has(command.id)) {
                    seen.add(command.id);
                    starred.push(command);
                }
            }
        }
        return searchActionCommands(starred, query);
    }, [activeTab, query, sidebarGroups, starredIds]);

    /** Every other tab keeps the subject sections, each ranked by the matcher the `/` creator uses. */
    const visibleGroups = useMemo<StoryCommandSidebarGroup[]>(() => {
        if (activeTab === STARRED_CATEGORY_ID) {
            return [];
        }
        return filterSidebarGroups(sidebarGroups, activeTab === ALL_CATEGORY_ID ? null : activeTab)
            .map(entry => ({ ...entry, commands: searchActionCommands(entry.commands, query) }))
            .filter(entry => entry.commands.length > 0);
    }, [activeTab, query, sidebarGroups]);

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
                    <CategoryChip
                        icon={Star}
                        iconColor="#c8b06e"
                        label={t("story.actionCreator.starred")}
                        active={activeTab === STARRED_CATEGORY_ID}
                        onClick={() => setActiveTab(STARRED_CATEGORY_ID)}
                    />
                    <CategoryChip
                        icon={LayoutGrid}
                        iconColor="#a8adb5"
                        label={t("story.actionCategory.all")}
                        active={activeTab === ALL_CATEGORY_ID}
                        onClick={() => setActiveTab(ALL_CATEGORY_ID)}
                    />
                    {STORY_COMMAND_CATEGORIES.map(category => (
                        <CategoryChip
                            key={category.id}
                            icon={category.icon}
                            iconColor={category.iconColor}
                            label={t(commandCategoryLabelKey(category.id))}
                            active={activeTab === category.id}
                            onClick={() => setActiveTab(category.id)}
                        />
                    ))}
                </div>
            </div>

            <div className="nl-no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2">
                {starredCommands.length === 0 && visibleGroups.length === 0 ? (
                    <div className="rounded-md border border-edge bg-fill-subtle px-3 py-3 text-sm text-fg-subtle">
                        {t("story.actionCreator.noActions")}
                    </div>
                ) : null}
                {/* Starred: one flat bucket, so no subject header over it. */}
                <div className="grid grid-cols-1 gap-1">
                    {starredCommands.map(command => (
                        <ActionCreatorRow
                            key={command.id}
                            command={command}
                            iconColor={getCommandGroup(command.group).iconColor}
                            starred
                            onToggleStarred={toggleStarred}
                            onCreate={createAction}
                        />
                    ))}
                </div>
                {visibleGroups.map(entry => {
                    const Icon = entry.group.icon;
                    return (
                        <div key={entry.group.id}>
                            <div className="flex items-center gap-1.5 px-1.5 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-fg-subtle">
                                <Icon className="h-3 w-3 shrink-0" style={{ color: entry.group.iconColor }} />
                                <span>{t(commandCategoryLabelKey(entry.group.id))}</span>
                            </div>
                            <div className="grid grid-cols-1 gap-1">
                                {entry.commands.map(command => (
                                    <ActionCreatorRow
                                        key={`${entry.group.id}:${command.id}`}
                                        command={command}
                                        iconColor={entry.group.iconColor}
                                        starred={starredIds.has(command.id)}
                                        onToggleStarred={toggleStarred}
                                        onCreate={createAction}
                                    />
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function CategoryChip(props: {
    icon: typeof Star;
    iconColor: string;
    label: string;
    active: boolean;
    onClick: () => void;
}) {
    const Icon = props.icon;
    return (
        <button
            type="button"
            className={[
                "flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
                props.active
                    ? "border-primary/45 bg-primary/15 text-fg"
                    : "border-edge bg-fill-subtle text-fg-muted hover:bg-fill hover:text-fg",
            ].join(" ")}
            onClick={props.onClick}
        >
            <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: props.iconColor }} />
            <span>{props.label}</span>
        </button>
    );
}

function ActionCreatorRow(props: {
    command: PaletteActionCommand;
    iconColor: string;
    starred: boolean;
    onToggleStarred: (commandId: string) => void;
    onCreate: (commandId: string) => void;
}) {
    const { t } = useTranslation();
    const Icon = props.command.icon;
    return (
        <div className="group flex items-center rounded-md transition-colors hover:bg-fill">
            <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                onClick={() => props.onCreate(props.command.id)}
            >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-edge bg-fill-subtle">
                    <Icon className="h-4 w-4" style={{ color: props.iconColor }} />
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
