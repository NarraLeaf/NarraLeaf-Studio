import { useRef } from "react";
import { CircleQuestionMark } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { openHelpTopic } from "./helpController";
import { helpTitleKey, type HelpTopicId } from "./helpTopics";

/**
 * The mouse's way to the popover: a `?` that appears when the pointer is over the header it sits in.
 *
 * Hover-revealed rather than always drawn, because a permanent `?` on every panel is a row of
 * identical glyphs that reads as decoration. It carries an accessible name and stays reachable by
 * keyboard (`focus-visible` reveals it too), so hiding it costs nothing but pixels.
 *
 * Put it inside a container that sets `group/help`; the header's own hover state then drives it.
 */
export function HelpTrigger({ topic, className }: { topic: HelpTopicId; className?: string }) {
    const { t } = useTranslation();
    const ref = useRef<HTMLButtonElement | null>(null);

    return (
        <button
            ref={ref}
            type="button"
            aria-label={t("help.ui.openTopic", { title: t(helpTitleKey(topic)) })}
            onClick={() => openHelpTopic(topic, ref.current)}
            className={cn(
                "flex h-6 w-6 shrink-0 cursor-default items-center justify-center rounded-md text-fg-subtle",
                "opacity-0 transition-opacity hover:bg-fill hover:text-fg-muted",
                "group-hover/help:opacity-100 focus-visible:opacity-100",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
                className,
            )}
        >
            <CircleQuestionMark className="h-3.5 w-3.5" />
        </button>
    );
}
