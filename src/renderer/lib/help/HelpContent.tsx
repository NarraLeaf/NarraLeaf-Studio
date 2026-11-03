import { useEffect, useMemo, useRef } from "react";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { getInterface } from "@/lib/app/bridge";
import { isMacPlatform } from "@/lib/app/platform";
import { useReduceMotion } from "@/lib/appearance/useReduceMotion";
import { formatKeybinding } from "@/lib/workspace/services/ui/keybindingFormat";
import { getKeybindingCatalogEntry } from "@/lib/workspace/services/ui/keybindingCatalog";
import {
    formatFixedInput,
    getFixedInputEntry,
    getFixedInputsExtending,
    resolveFixedInputDisplay,
    type FixedInput,
} from "@/lib/workspace/services/ui/fixedInputCatalog";
import { parseHelpBody } from "./helpBody";
import { getHelpTopic, helpBodyKey, helpClipUrl, helpTitleKey, type HelpTopic, type HelpTopicId } from "./helpTopics";

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

/**
 * A topic's recording: a few seconds of the skeleton project showing the thing the body describes.
 *
 * With Reduce motion on it is the first frame, held: a looping picture beside text is exactly the
 * motion that setting asks to remove, and the stylesheet cannot stop an animated image the way it
 * stops a transition. `createImageBitmap` decodes only that frame.
 *
 * Every recording is 640 by 400, so the box is sized before the file arrives: the popover measures
 * itself to stay on screen, and an image that grew it after the measurement would push it off.
 */
function HelpClip({ topic }: { topic: HelpTopic }) {
    const { t, locale } = useTranslation();
    const reduced = useReduceMotion();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const url = helpClipUrl(topic.id, locale);
    const label = t(helpTitleKey(topic.id));

    useEffect(() => {
        if (!reduced) return;
        let cancelled = false;
        void fetch(url)
            .then(response => response.blob())
            .then(blob => createImageBitmap(blob))
            .then(bitmap => {
                const canvas = canvasRef.current;
                if (cancelled || !canvas) return bitmap.close();
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
                bitmap.close();
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [reduced, url]);

    const frame = "mb-3 block aspect-[8/5] w-full rounded-md border border-edge-subtle bg-surface-canvas object-contain";
    return reduced ? (
        <canvas ref={canvasRef} role="img" aria-label={label} className={frame} />
    ) : (
        <img src={url} alt={label} draggable={false} className={frame} />
    );
}

export function HelpContent({ topic, resolveShortcut = defaultShortcut, onOpenTopic, className }: HelpContentProps) {
    const { t } = useTranslation();
    const blocks = useMemo(() => parseHelpBody(t(helpBodyKey(topic.id))), [t, topic.id]);
    const isMac = isMacPlatform();

    // A row is a command and every way to run it: a rebindable chord (as bound now) followed by the
    // gestures that do the same, or, for a fixed-input entry, its gestures and fixed keys alone.
    const formatInput = (input: FixedInput) => formatFixedInput(input, isMac, t);
    const shortcuts = (topic.shortcuts ?? [])
        .map((id): { id: string; label: string; inputs: string[] } | null => {
            const binding = getKeybindingCatalogEntry(id);
            if (binding) {
                const key = resolveShortcut(id);
                return key
                    ? {
                          id,
                          label: t(binding.labelKey),
                          inputs: [formatKeybinding(key, isMac), ...getFixedInputsExtending(id).map(formatInput)],
                      }
                    : null;
            }
            const fixed = getFixedInputEntry(id);
            const display = fixed ? resolveFixedInputDisplay(fixed) : null;
            return fixed && display
                ? { id, label: t(display.labelKey), inputs: fixed.inputs.map(formatInput) }
                : null;
        })
        .filter((row): row is { id: string; label: string; inputs: string[] } => row !== null);

    const related = (topic.related ?? [])
        .map(id => getHelpTopic(id))
        .filter((entry): entry is HelpTopic => entry !== undefined);

    return (
        <div className={cn("text-xs leading-relaxed text-fg-muted", className)}>
            {topic.clip && <HelpClip topic={topic} />}
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
                        <div key={row.id} className="flex min-h-6 items-center gap-3 py-0.5">
                            <span className="min-w-0 flex-1 text-2xs text-fg-subtle">{row.label}</span>
                            <span className="flex max-w-[65%] flex-wrap justify-end gap-1">
                                {row.inputs.map((input, index) => (
                                    <span
                                        key={index}
                                        className="whitespace-nowrap rounded-md border border-edge bg-fill-subtle px-1.5 text-2xs tabular-nums text-fg-muted"
                                    >
                                        {input}
                                    </span>
                                ))}
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
