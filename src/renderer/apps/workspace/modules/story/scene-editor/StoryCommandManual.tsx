import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { SearchBox } from "@/apps/workspace/modules/assets/components/SearchBox";
import {
    ACTION_COMMAND_CATEGORIES,
    getActionCommandCategory,
    translateActionCommandCategoryLabel,
} from "./storyActionCommands";
import {
    buildStoryCommandManual,
    filterStoryCommandManual,
    type StoryCommandManualEntry,
} from "./storyCommandManualModel";

/**
 * The command reference (WI-2): a read-only overlay listing every command's signature, aliases, and
 * description, derived entirely from the spec registry (see `storyCommandManual`). Opened from the
 * scene editor's header; Esc or a backdrop click closes. Chrome mirrors the keyboard cheat sheet — the
 * same "here is everything, generated from the source of truth" surface, scoped to the story editor.
 */
export function StoryCommandManual(props: { onClose: () => void }) {
    const { t } = useTranslation();
    const [query, setQuery] = useState("");

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                props.onClose();
            }
        };
        document.addEventListener("keydown", handleKeyDown, true);
        return () => document.removeEventListener("keydown", handleKeyDown, true);
    }, [props]);

    // Grouped by category, in category order, dropping empty groups. Rebuilt on locale (t) and query.
    const groups = useMemo(() => {
        const entries = filterStoryCommandManual(buildStoryCommandManual(t), query);
        return ACTION_COMMAND_CATEGORIES
            .filter(category => category.id !== "all")
            .map(category => ({
                category,
                entries: entries.filter(entry => entry.category === category.id),
            }))
            .filter(group => group.entries.length > 0);
    }, [query, t]);

    return (
        <div className="nl-window-content-layer z-50 flex items-center justify-center p-6">
            <div className="absolute inset-0 bg-black/30 animate-fade-in" onMouseDown={props.onClose} />
            <div className="relative flex max-h-full w-[min(760px,calc(100vw-48px))] flex-col overflow-hidden rounded-md border border-edge bg-surface-raised shadow-2xl">
                <div className="flex shrink-0 items-center gap-3 border-b border-edge px-4 py-3">
                    <span className="text-sm font-medium text-fg">{t("story.commandManual.title")}</span>
                    <div className="ml-auto w-56">
                        <SearchBox
                            value={query}
                            onChange={setQuery}
                            placeholder={t("story.commandManual.searchPlaceholder")}
                            className="w-full"
                        />
                    </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                    {groups.length === 0 ? (
                        <div className="px-1 py-6 text-center text-sm text-fg-subtle">{t("story.commandManual.empty")}</div>
                    ) : (
                        groups.map(group => {
                            const Icon = group.category.icon;
                            return (
                                <div key={group.category.id}>
                                    <div className="flex items-center gap-1.5 pb-1 pt-3 text-2xs font-medium uppercase tracking-wide text-fg-subtle">
                                        <Icon className="h-3 w-3 shrink-0" style={{ color: group.category.iconColor }} />
                                        <span>{translateActionCommandCategoryLabel(group.category, t)}</span>
                                    </div>
                                    {group.entries.map(entry => (
                                        <ManualRow key={entry.id} entry={entry} aliasesLabel={t("story.commandManual.aliases")} />
                                    ))}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}

function ManualRow(props: { entry: StoryCommandManualEntry; aliasesLabel: string }) {
    const { entry } = props;
    const category = getActionCommandCategory(entry.category);
    const Icon = category.icon;
    return (
        <div className="flex items-start gap-2 rounded px-2 py-1.5">
            <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: category.iconColor }} />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <code className="font-mono text-sm text-fg">{entry.signature}</code>
                    <span className="text-xs text-fg-muted">{entry.label}</span>
                </div>
                <div className="mt-0.5 truncate text-2xs text-fg-subtle">{entry.detail}</div>
                {entry.aliases.length > 0 ? (
                    <div className="mt-0.5 text-2xs text-fg-subtle">
                        {props.aliasesLabel}
                        {": "}
                        <span className="font-mono">{entry.aliases.join(", ")}</span>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
