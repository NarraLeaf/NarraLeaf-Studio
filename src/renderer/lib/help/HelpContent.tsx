import { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { getInterface } from "@/lib/app/bridge";
import { isMacPlatform } from "@/lib/app/platform";
import { formatKeybinding } from "@/lib/workspace/services/ui/keybindingFormat";
import { getKeybindingCatalogEntry } from "@/lib/workspace/services/ui/keybindingCatalog";
import { parseHelpBody } from "./helpBody";
import { getHelpTopic, helpBodyKey, helpTitleKey, type HelpTopic, type HelpTopicId } from "./helpTopics";

/**
 * One topic, rendered the same way wherever it is shown - the popover, the launcher's reader and the
 * workspace's help tab all call this, so a topic cannot look like two different things.
 *
 * The three parts below the body are all cross-references resolved at render time rather than
 * written into the copy: the chord comes from the keybinding service (so a rebound key shows
 * rebound), and the related links come from the registry (so a renamed topic renames here too).
 */

export interface HelpContentProps {
    topic: HelpTopic;
    /**
     * The chord actually bound to a catalog id right now. The workspace passes its keybinding
     * service; the launcher has none, so the catalog default is used.
     */
    resolveShortcut?: (catalogId: string) => string | undefined;
    /** Follow a `See also` link. Omitted where there is nowhere to navigate to. */
    onOpenTopic?: (id: HelpTopicId) => void;
    className?: string;
}

function defaultShortcut(catalogId: string): string | undefined {
    return getKeybindingCatalogEntry(catalogId)?.key;
}

/**
 * How a link inside a topic behaves on hover: the pointer cursor and an underline.
 *
 * Studio's controls are `cursor-default` throughout (a tool, not a web page), and these are the
 * exception on purpose - they are the only things in a topic that go somewhere, they sit inline in
 * running text where nothing else marks them as targets, and colour alone was doing all the work.
 * A disabled one (no navigation handler) keeps neither, so it cannot promise a jump it will not make.
 */
const HELP_LINK_CLASS =
    "cursor-pointer text-primary underline-offset-2 transition-opacity hover:underline hover:opacity-80 "
    + "disabled:cursor-default disabled:text-fg-muted disabled:no-underline disabled:opacity-100";

export function HelpContent({ topic, resolveShortcut = defaultShortcut, onOpenTopic, className }: HelpContentProps) {
    const { t } = useTranslation();
    const blocks = useMemo(() => parseHelpBody(t(helpBodyKey(topic.id))), [t, topic.id]);
    const isMac = isMacPlatform();

    const shortcuts = (topic.shortcuts ?? [])
        .map(catalogId => {
            const entry = getKeybindingCatalogEntry(catalogId);
            const key = resolveShortcut(catalogId);
            return entry && key ? { id: catalogId, label: t(entry.labelKey), key } : null;
        })
        .filter((row): row is { id: string; label: string; key: string } => row !== null);

    const related = (topic.related ?? [])
        .map(id => getHelpTopic(id))
        .filter((entry): entry is HelpTopic => entry !== undefined);

    return (
        <div className={cn("text-xs leading-relaxed text-fg-muted", className)}>
            {blocks.map((block, index) =>
                block.kind === "paragraph" ? (
                    <p key={index} className="mt-2 first:mt-0">
                        {block.text}
                    </p>
                ) : (
                    <ul key={index} className="mt-2 space-y-1 first:mt-0">
                        {block.items.map((item, itemIndex) => (
                            <li key={itemIndex} className="flex gap-2">
                                <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-fg-subtle" />
                                <span className="min-w-0">{item}</span>
                            </li>
                        ))}
                    </ul>
                ),
            )}

            {shortcuts.length > 0 && (
                <div className="mt-3 border-t border-edge-subtle pt-2">
                    {shortcuts.map(row => (
                        <div key={row.id} className="flex h-6 items-center gap-3">
                            <span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">{row.label}</span>
                            <span className="shrink-0 rounded-md border border-edge bg-fill-subtle px-1.5 text-2xs tabular-nums text-fg-muted">
                                {formatKeybinding(row.key, isMac)}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {(related.length > 0 || topic.learnMore) && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-edge-subtle pt-2 text-2xs">
                    <span className="text-fg-subtle">{t("help.ui.related")}</span>
                    {related.map(entry => (
                        <button
                            key={entry.id}
                            type="button"
                            disabled={!onOpenTopic}
                            onClick={() => onOpenTopic?.(entry.id)}
                            className={HELP_LINK_CLASS}
                        >
                            {t(helpTitleKey(entry.id))}
                        </button>
                    ))}
                    {topic.learnMore && (
                        <button
                            type="button"
                            onClick={() => void getInterface().app.openExternal(topic.learnMore!)}
                            className={cn("flex items-center gap-1", HELP_LINK_CLASS)}
                        >
                            {t("help.ui.learnMore")}
                            <ExternalLink className="h-3 w-3" />
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
