import { useCallback, useEffect, useMemo, useState } from "react";
import { Star } from "lucide-react";
import type { PanelComponentProps } from "../../types";
import { SearchBox } from "@/apps/workspace/modules/assets/components/SearchBox";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import {
    ACTION_COMMAND_CATEGORIES,
    ACTION_COMMANDS,
    actionCommandMatchesQuery,
    getActionCommandCategory,
    type ActionCommand,
    type ActionCommandCategory,
    type ActionCommandId,
} from "./storyActionCommands";
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
    const { context, isInitialized } = useWorkspace();
    const settingsService = useMemo(
        () => context && isInitialized ? context.services.get<GlobalSettingsService>(Services.GlobalSettings) : null,
        [context, isInitialized],
    );
    const [query, setQuery] = useState("");
    const [activeCategoryId, setActiveCategoryId] = useState<SidebarCategory["id"]>("all");
    const [starredIds, setStarredIds] = useState<Set<ActionCommandId>>(() => new Set());

    useEffect(() => {
        if (!settingsService) {
            return;
        }
        const stored = settingsService.getSync<string[]>(FAVORITES_SETTING_KEY, []) ?? [];
        setStarredIds(new Set(stored.filter(isActionCommandId)));
    }, [settingsService]);

    const persistStarredIds = useCallback((next: Set<ActionCommandId>) => {
        if (!settingsService) {
            return;
        }
        void settingsService.set(FAVORITES_SETTING_KEY, [...next]).catch(error => {
            console.warn("[StoryActionCreatorPanel] failed to save starred actions", error);
        });
    }, [settingsService]);

    const toggleStarred = useCallback((commandId: ActionCommandId) => {
        setStarredIds(previous => {
            const next = new Set(previous);
            next.has(commandId) ? next.delete(commandId) : next.add(commandId);
            persistStarredIds(next);
            return next;
        });
    }, [persistStarredIds]);

    const categories = useMemo<SidebarCategory[]>(() => [
        { id: STARRED_CATEGORY_ID, label: "Starred", icon: Star, iconColor: "#c8b06e" },
        ...ACTION_COMMAND_CATEGORIES,
    ], []);

    const filteredCommands = useMemo(() => {
        return ACTION_COMMANDS.filter(command => {
            if (activeCategoryId === STARRED_CATEGORY_ID && !starredIds.has(command.id)) {
                return false;
            }
            if (activeCategoryId !== STARRED_CATEGORY_ID && activeCategoryId !== "all" && command.category !== activeCategoryId) {
                return false;
            }
            return actionCommandMatchesQuery(command, query);
        });
    }, [activeCategoryId, query, starredIds]);

    const createAction = useCallback((commandId: ActionCommandId) => {
        if (!payload?.tabId) {
            return;
        }
        dispatchStoryActionCreateRequest({ tabId: payload.tabId, commandId });
    }, [payload?.tabId]);

    return (
        <div className="flex h-full min-h-0 flex-col bg-[#101318]">
            <div className="border-b border-white/10 bg-[#0f1115] px-3 py-3">
                <SearchBox
                    value={query}
                    onChange={setQuery}
                    placeholder="Search actions"
                    className="w-full"
                />
                <div
                    className="mt-3 flex gap-1 overflow-x-auto pb-0.5"
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
                                        ? "border-primary/45 bg-primary/15 text-white"
                                        : "border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.06] hover:text-slate-100",
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

            <div className="min-h-0 flex-1 overflow-auto p-2">
                {filteredCommands.length === 0 ? (
                    <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-500">
                        No action found.
                    </div>
                ) : (
                    <div className="grid gap-1">
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
    command: ActionCommand;
    starred: boolean;
    onToggleStarred: (commandId: ActionCommandId) => void;
    onCreate: (commandId: ActionCommandId) => void;
}) {
    const category = getActionCommandCategory(props.command.category);
    const Icon = props.command.icon;
    return (
        <div className="group flex items-center rounded-md transition-colors hover:bg-white/[0.06]">
            <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                onClick={() => props.onCreate(props.command.id)}
            >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.04]">
                    <Icon className="h-4 w-4" style={{ color: category.iconColor }} />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-100">{props.command.label}</span>
                    <span className="block truncate text-[11px] text-slate-500">{props.command.detail}</span>
                </span>
            </button>
            <button
                type="button"
                className={[
                    "mr-1 grid h-7 w-7 shrink-0 place-items-center rounded text-slate-500 transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
                    props.starred ? "opacity-100 text-[#c8b06e]" : "opacity-0 hover:text-[#c8b06e] group-hover:opacity-100",
                ].join(" ")}
                title={props.starred ? "Remove from starred" : "Add to starred"}
                onClick={() => props.onToggleStarred(props.command.id)}
            >
                <Star className="h-3.5 w-3.5" fill={props.starred ? "currentColor" : "none"} />
            </button>
        </div>
    );
}

function isActionCommandId(value: string): value is ActionCommandId {
    return ACTION_COMMANDS.some(command => command.id === value);
}
