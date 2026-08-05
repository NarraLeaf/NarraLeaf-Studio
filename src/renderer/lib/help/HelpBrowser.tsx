import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { SearchInput } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { getInterface } from "@/lib/app/bridge";
import { HelpContent } from "./HelpContent";
import {
    filterHelpTopics,
    getHelpTopic,
    HELP_TOPICS,
    helpSectionKey,
    helpTitleKey,
    helpTopicsBySection,
    type HelpTopicId,
} from "./helpTopics";

/**
 * The whole topic set as a reader: list on the left, one topic on the right.
 *
 * Shared by the launcher's Learning tab and the workspace's help tab, so the two cannot drift into
 * different documentation. It has no chrome of its own beyond the search field - the surface hosting
 * it supplies the title, because in one case it is a launcher page and in the other an editor tab.
 *
 * `resources` are the pages that are deliberately *not* bundled (the site, the repositories). They
 * are a section at the end of the list rather than the page itself, which is what this replaced.
 */

export interface HelpBrowserResource {
    id: string;
    /** The link's whole label. There is no room for a second line, and a link needs no summary. */
    title: string;
    url: string;
}

export interface HelpBrowserProps {
    /** Topic to show on mount; the first one otherwise. */
    initialTopic?: HelpTopicId;
    resources?: readonly HelpBrowserResource[];
    /** Chord resolver handed to {@link HelpContent}. */
    resolveShortcut?: (catalogId: string) => string | undefined;
    className?: string;
}

export function HelpBrowser({ initialTopic, resources = [], resolveShortcut, className }: HelpBrowserProps) {
    const { t } = useTranslation();
    const [query, setQuery] = useState("");
    const [selectedId, setSelectedId] = useState<HelpTopicId>(initialTopic ?? HELP_TOPICS[0].id);

    // The host can retarget an already-open reader (the workspace reuses one tab, so "open help at
    // Versions" while help is open has to move the selection rather than do nothing). Keyed on the
    // prop, so the author's own clicks are never overwritten.
    useEffect(() => {
        if (initialTopic) {
            setSelectedId(initialTopic);
        }
    }, [initialTopic]);

    const matches = useMemo(() => filterHelpTopics(HELP_TOPICS, query, t), [query, t]);
    const matchedIds = useMemo(() => new Set(matches.map(topic => topic.id)), [matches]);

    // Sections keep their order and their headings while filtering; a section with no match drops
    // out entirely rather than showing an empty heading.
    const groups = useMemo(
        () =>
            helpTopicsBySection()
                .map(group => ({ ...group, topics: group.topics.filter(topic => matchedIds.has(topic.id)) }))
                .filter(group => group.topics.length > 0),
        [matchedIds],
    );

    // A filter that hides the selected topic still shows it on the right: the author is reading it,
    // and blanking the pane because of a keystroke in the search field loses their place.
    const selected = getHelpTopic(selectedId) ?? matches[0];

    const showResources = resources.length > 0 && !query.trim();

    return (
        <div className={cn("flex h-full min-h-0 w-full", className)}>
            <div className="flex w-56 min-w-0 shrink-0 flex-col border-r border-edge">
                <div className="p-2">
                    <SearchInput
                        size="sm"
                        fullWidth
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder={t("help.ui.searchPlaceholder")}
                        aria-label={t("help.ui.searchPlaceholder")}
                    />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                    {groups.length === 0 && (
                        <p className="px-3 py-2 text-2xs text-fg-subtle">{t("help.ui.noResults")}</p>
                    )}
                    {groups.map(group => (
                        <div key={group.section}>
                            <div className="px-3 pb-1 pt-3 text-2xs text-fg-subtle">
                                {t(helpSectionKey(group.section))}
                            </div>
                            {group.topics.map(topic => (
                                <button
                                    key={topic.id}
                                    type="button"
                                    onClick={() => setSelectedId(topic.id)}
                                    className={cn(
                                        "flex h-7 w-full cursor-default items-center truncate px-3 text-left text-xs transition-colors",
                                        topic.id === selected?.id
                                            ? "bg-primary/15 text-fg"
                                            : "text-fg-muted hover:bg-fill",
                                    )}
                                >
                                    {t(helpTitleKey(topic.id))}
                                </button>
                            ))}
                        </div>
                    ))}

                    {showResources && (
                        <div>
                            <div className="px-3 pb-1 pt-3 text-2xs text-fg-subtle">{t("help.ui.resources")}</div>
                            {resources.map(resource => (
                                <button
                                    key={resource.id}
                                    type="button"
                                    onClick={() => void getInterface().app.openExternal(resource.url)}
                                    className="group flex h-7 w-full cursor-default items-center gap-1.5 px-3 text-left text-xs text-fg-muted transition-colors hover:bg-fill"
                                >
                                    <span className="min-w-0 flex-1 truncate">{resource.title}</span>
                                    <ExternalLink className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="min-w-0 flex-1 overflow-y-auto">
                {selected ? (
                    <div className="mx-auto max-w-2xl px-6 py-5">
                        <h2 className="text-base font-medium text-fg">{t(helpTitleKey(selected.id))}</h2>
                        <HelpContent
                            topic={selected}
                            resolveShortcut={resolveShortcut}
                            onOpenTopic={setSelectedId}
                            className="mt-3"
                        />
                    </div>
                ) : (
                    <p className="px-6 py-5 text-xs text-fg-subtle">{t("help.ui.pickTopic")}</p>
                )}
            </div>
        </div>
    );
}
